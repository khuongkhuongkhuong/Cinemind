import { runInTransaction } from '../dao/transaction.js';
import {
  ORDER_INCLUDE, cancelPendingOrderIfNotExpired, checkInIfNotUsed, countOrdersOfUser, findActivePendingOrderIds, findOrderByCode,
  findOrdersOfUser, getOrderById, getOrderDetail, getOrderDetailByCode, getOrderForRecalc, getOrderLines, getOrderOwner, getOrderStatus as findOrderStatus,
  insertOrder, listStalePendingOrderIds, markOrderExpiredIfStale, markOrderPaid, markOrdersCancelled, setOrderPromotion, setOrderStatus,
  touchPendingOrder, updateOrderTotals,
} from '../dao/order.dao.js';
import { deleteCombosOfOrder, insertOrderCombos } from '../dao/orderCombo.dao.js';
import { AppError } from '../utils/AppError.js';
import { generateOrderCode, normalizeTicketCode } from '../lib/code.js';
import { buildMeta, toSkipTake } from '../utils/pagination.js';
import * as showtimeService from './showtime.service.js';
import * as seatService from './seat.service.js';
import * as ticketService from './ticket.service.js';
import * as pricingService from './pricing.service.js';
import * as comboService from './combo.service.js';
import * as userService from './user.service.js';
import { assertPromotionUsable, calcDiscount, findPromotionByCode, recordUsage } from './promotion.service.js';

const HOLD_MINUTES = 10; // BR-01: giữ ghế 10 phút, không gia hạn
const MAX_SEATS = 8; // BR-02
const MAX_ATTEMPTS = 3;
// Nhiều người giành ghế cùng lúc => transaction phải xếp hàng chờ nhau; nới thời gian chờ mặc định (2s/5s).
const TX_OPTIONS = { maxWait: 10_000, timeout: 15_000 };

// Hình dạng "đơn đầy đủ" nay nằm ở DAO; re-export để các nơi đang import từ đây (adminOrder...) không phải đổi.
export const orderInclude = ORDER_INCLUDE;

/**
 * Dòng Order của Prisma (kèm `tickets[].showtime`, xem `ORDER_INCLUDE`) -> cấu trúc `Order` dùng chung (04-api-contract mục 3.4).
 * @param {object} o
 * @returns {object}
 */
export function toOrderDto(o) {
  const { showtime } = o.tickets[0]; // suất nằm ở vé; mọi vé của một đơn cùng một suất
  return {
    id: o.id,
    code: o.code,
    status: o.status,
    expiresAt: o.expiresAt,
    showtime: {
      id: showtime.id,
      startTime: showtime.startTime,
      format: showtime.format,
      audio: showtime.audio,
      movie: showtime.movie,
      cinema: { name: showtime.room.cinema.name },
      room: { name: showtime.room.name },
    },
    seats: o.tickets.map((s) => ({ seatId: s.seatId, label: s.seatLabel, type: s.seatType, price: s.price })),
    combos: o.combos.map((c) => ({
      comboId: c.comboId, name: c.combo.name, quantity: c.quantity, unitPrice: c.unitPrice, subtotal: c.quantity * c.unitPrice,
    })),
    promotion: o.promotion ? { code: o.promotion.code, name: o.promotion.name, discount: o.discount } : null,
    seatTotal: o.seatTotal,
    comboTotal: o.comboTotal,
    discount: o.discount,
    total: o.total,
    paidAt: o.paidAt,
    checkedInAt: o.checkedInAt,
  };
}

/**
 * Bước kiểm tra TRƯỚC transaction: các luật không cần khóa gì cả. Trả về ghế + giá đã tính.
 * @throws {AppError} NOT_FOUND | SHOWTIME_CLOSED | SEAT_LIMIT_EXCEEDED | SEAT_UNAVAILABLE | COUPLE_SEAT_INCOMPLETE
 */
async function validateRequest({ showtimeId, seatIds }) {
  const showtime = await showtimeService.getOpenShowtime({ showtimeId }); // NOT_FOUND | SHOWTIME_CLOSED (BR-04)

  if (seatIds.length === 0) {
    throw new AppError('VALIDATION_ERROR', { details: { fields: { seatIds: 'Cần chọn ít nhất một ghế.' } } }); // một đơn không có vé không thuộc suất nào
  }
  if (new Set(seatIds).size !== seatIds.length) {
    throw new AppError('VALIDATION_ERROR', { details: { fields: { seatIds: 'Có ghế bị chọn trùng.' } } });
  }
  if (seatIds.length > MAX_SEATS) throw new AppError('SEAT_LIMIT_EXCEEDED'); // BR-02

  const seats = await seatService.getSeatsForBooking({ roomId: showtime.roomId, seatIds }); // NOT_FOUND | SEAT_UNAVAILABLE | COUPLE_SEAT_INCOMPLETE
  // Server TỰ tính giá (BR-15); không bao giờ nhận số tiền từ client.
  const priced = await pricingService.priceSeats({ basePrice: showtime.basePrice, seats });
  return { showtime, seats, priced };
}

/** Một lần thử giữ ghế — toàn bộ nằm trong MỘT transaction: hoặc tất cả thành công, hoặc không thay đổi gì. */
function runHoldTransaction({ userId, showtime, seats, priced, source }) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + HOLD_MINUTES * 60_000);
  const priceBySeat = new Map(priced.seats.map((p) => [p.id, p.price]));

  return runInTransaction(async (tx) => {
    // 1. BR-03: hủy đơn PENDING còn hạn của chính user này + nhả vé của nó.
    //    Chỉ đơn CÒN HẠN: đơn đã quá hạn để cron chuyển EXPIRED, vì thanh toán đến muộn vẫn phải xử lý được (BR-31).
    //    Nằm TRONG transaction => nếu lần giữ mới thất bại thì rollback, đơn cũ vẫn còn nguyên.
    const oldIds = await findActivePendingOrderIds({ userId, now }, tx);
    if (oldIds.length) {
      await ticketService.releaseTicketsOfOrders(oldIds, tx);
      await markOrdersCancelled(oldIds, tx);
    }

    // 2. Tạo đơn (PENDING, hạn 10 phút).
    const order = await insertOrder({
      code: generateOrderCode(),
      userId,
      source,
      expiresAt,
      seatTotal: priced.total,
      total: priced.total,
    }, tx);

    // 3. ⭐ Dọn "lười" vé quá hạn trên các ghế đang xin rồi chèn TẤT CẢ vé của đơn trong MỘT câu lệnh (GIÁ CHỐT, BR-14).
    //    UNIQUE (showtimeId, occupiedSeatId) của PostgreSQL cho đúng một người thắng mỗi ghế; trùng ghế nào => P2002 => ROLLBACK.
    //    TUYỆT ĐỐI không dùng skipDuplicates: nó lặng lẽ bỏ ghế trùng và gây bán trùng.
    await ticketService.holdTickets({
      orderId: order.id,
      showtimeId: showtime.id,
      now,
      seats: seats.map((s) => ({ seatId: s.id, seatLabel: `${s.row}${s.number}`, seatType: s.type, price: priceBySeat.get(s.id) })),
    }, tx);

    return getOrderDetail(order.id, tx);
  }, TX_OPTIONS);
}

/** Sau khi thua: tra xem ghế nào đang bị người khác giữ/mua, để báo lại cho client (details của SEAT_UNAVAILABLE). */
async function findConflicts({ showtimeId, seatIds }) {
  return ticketService.findTakenSeats({ showtimeId, seatIds }); // vé HELD còn hạn hoặc đã bán
}

/**
 * Giữ ghế và tạo đơn PENDING (hạn 10 phút). ⭐ Chống trùng ghế bằng UNIQUE (showtimeId, occupiedSeatId) của Ticket.
 * @param {{ userId: string, showtimeId: string, seatIds: string[], source?: 'WEB' | 'AI_CHAT' }} params
 *   userId lấy từ token, không từ body. `source` mặc định WEB; chỉ kênh trợ lý AI (server) truyền AI_CHAT — API REST không nhận trường này.
 * @returns {Promise<object>} `Order` (04-api-contract mục 3.4)
 * @throws {AppError} NOT_FOUND | SHOWTIME_CLOSED | SEAT_LIMIT_EXCEEDED | COUPLE_SEAT_INCOMPLETE | SEAT_UNAVAILABLE
 */
export async function holdSeats({ userId, showtimeId, seatIds, source = 'WEB' }) {
  if (!['WEB', 'AI_CHAT'].includes(source)) throw new AppError('VALIDATION_ERROR', { details: { fields: { source: 'Nguồn đơn không hợp lệ.' } } });
  const request = await validateRequest({ showtimeId, seatIds });

  for (let attempt = 1; ; attempt++) {
    try {
      return toOrderDto(await runHoldTransaction({ userId, source, ...request }));
    } catch (err) {
      if (err.code !== 'P2002') throw err; // lỗi khác (mất kết nối...) thì để errorHandler lo
      const conflicts = await findConflicts({ showtimeId, seatIds });
      if (conflicts.length) {
        throw new AppError('SEAT_UNAVAILABLE', {
          message: `Ghế ${conflicts.map((c) => c.label).join(', ')} vừa có người chọn, vui lòng chọn ghế khác.`,
          details: { seatIds: conflicts.map((c) => c.seatId), seatLabels: conflicts.map((c) => c.label) },
        });
      }
      // P2002 mà không thấy ghế nào bị chiếm: người giữ trước đã rollback ngay sau khi ta thua (hoặc trùng mã đơn
      // cực hiếm). Thử lại; hết lượt thì báo lỗi gốc.
      if (attempt >= MAX_ATTEMPTS) throw err;
    }
  }
}

/**
 * Xem một đơn của chính mình.
 * @param {{ userId: string, orderId: string }} params
 * @throws {AppError} NOT_FOUND | FORBIDDEN
 */
export async function getOrder({ userId, orderId }) {
  const order = await getOrderDetail(orderId);
  if (!order) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy đơn hàng.' });
  if (order.userId !== userId) throw new AppError('FORBIDDEN');
  return toOrderDto(order);
}

/**
 * Hủy đơn đang giữ ghế (BR-07): đơn -> CANCELLED và nhả vé (HELD -> RELEASED), trong một transaction.
 * Chỉ hủy được đơn PENDING còn hạn; sau khi thanh toán thì không hủy (BR-08).
 * @param {{ userId: string, orderId: string }} params
 * @returns {Promise<object>} `Order` đã CANCELLED
 * @throws {AppError} NOT_FOUND | FORBIDDEN | ORDER_EXPIRED | ORDER_NOT_PENDING
 */
export async function cancelOrder({ userId, orderId }) {
  const order = await getOrderOwner(orderId);
  if (!order) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy đơn hàng.' });
  if (order.userId !== userId) throw new AppError('FORBIDDEN');

  const cancelled = await runInTransaction(async (tx) => {
    // Cập nhật CÓ ĐIỀU KIỆN trong một câu lệnh: nếu IPN thanh toán vừa chuyển đơn sang PAID cùng lúc,
    // điều kiện status = PENDING sai => count = 0 => không hủy nhầm đơn đã trả tiền.
    const count = await cancelPendingOrderIfNotExpired({ orderId, now: new Date() }, tx);
    if (count === 1) await ticketService.releaseTicketsOfOrders([orderId], tx);
    return count === 1;
  });

  if (!cancelled) {
    // Không hủy được: xem lý do để báo đúng mã lỗi (đã hết hạn giữ ghế, hay đơn không còn PENDING).
    const now = await findOrderStatus(orderId);
    throw new AppError(now.status === 'PENDING' ? 'ORDER_EXPIRED' : 'ORDER_NOT_PENDING');
  }
  return getOrder({ userId, orderId });
}

/**
 * Dọn đơn PENDING đã quá hạn: -> EXPIRED và nhả vé HELD của đơn (03-database mục 5.6).
 * Chỉ để dữ liệu sạch: hệ thống vẫn ĐÚNG khi hàm này không chạy, vì vé HELD quá hạn đã được coi là trống.
 * @param {{ now?: Date }} [params]
 * @returns {Promise<number>} số đơn đã chuyển EXPIRED
 */
export async function expirePendingOrders({ now = new Date() } = {}) {
  const staleIds = await listStalePendingOrderIds({ now }); // dùng index (status, expiresAt)
  let expired = 0;
  for (const id of staleIds) {
    await runInTransaction(async (tx) => {
      // Có điều kiện status = PENDING: nếu IPN vừa xác nhận đơn này thì count = 0 và ta không đụng vào.
      const count = await markOrderExpiredIfStale({ orderId: id, now }, tx);
      if (count === 1) {
        await ticketService.releaseTicketsOfOrders([id], tx);
        expired++;
      }
    });
  }
  return expired;
}

/**
 * "Vé của tôi": danh sách đơn của chính mình theo trạng thái (mặc định PAID), mới nhất trước.
 * @param {{ userId: string, status?: string, page: number, pageSize: number }} params
 * @returns {Promise<{ items: object[], meta: object }>} items là `OrderSummary` (04-api-contract mục 3.7)
 */
export async function listMyOrders({ userId, status = 'PAID', page, pageSize }) {
  const filter = { userId, status };
  const [total, rows] = await Promise.all([
    countOrdersOfUser(filter),
    findOrdersOfUser(filter, toSkipTake({ page, pageSize })),
  ]);
  const items = rows.map(({ tickets, ...o }) => ({
    ...o,
    seatLabels: tickets.map((s) => s.seatLabel),
    showtime: summarizeShowtime(tickets[0].showtime),
  }));
  return { items, meta: buildMeta({ page, pageSize }, total) };
}
/** Suất rút gọn cho `OrderSummary` (04-api-contract mục 3.7). */
const summarizeShowtime = (showtime) => ({
  id: showtime.id, startTime: showtime.startTime, format: showtime.format, audio: showtime.audio,
  movie: showtime.movie, cinema: { name: showtime.room.cinema.name }, room: { name: showtime.room.name },
});

/**
 * Chi tiết một đơn/vé của mình theo MÃ ĐƠN, kèm nội dung QR (chỉ khi đã thanh toán).
 * Mã của người khác trả NOT_FOUND (không phải FORBIDDEN) để không ai dò được mã nào tồn tại.
 * @param {{ userId: string, code: string }} params code không phân biệt hoa/thường
 * @returns {Promise<object>} `Order` + `qrContent`
 * @throws {AppError} NOT_FOUND
 */
export async function getMyOrderByCode({ userId, code }) {
  const order = await getOrderDetailByCode(code.toUpperCase());
  if (!order || order.userId !== userId) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy vé.' });
  return { ...toOrderDto(order), qrContent: order.status === 'PAID' ? `CINEMIND:${order.code}` : null };
}

// ---------------------------------------------------------------------------------------------
// Combo & khuyến mãi: mọi thao tác đổi tiền đều đi qua MỘT hàm tính lại (recalcOrder) để số tiền
// luôn do SERVER tính từ giá đã chốt (BR-14, BR-15), không rải công thức ở nhiều nơi.
// ---------------------------------------------------------------------------------------------

const MAX_COMBO_QTY = 10; // BR-20

/**
 * Tính lại seatTotal / comboTotal / discount / total của đơn từ các dòng đã chốt giá, rồi ghi vào Order.
 * Nếu mã khuyến mãi đang áp không còn hợp lệ với tổng mới (vd bỏ combo làm đơn dưới mức tối thiểu) thì GỠ mã,
 * để khách không bao giờ trả theo một mã mà họ không còn đủ điều kiện.
 * @param {object} tx prisma transaction
 * @param {string} orderId
 */
async function recalcOrder(tx, orderId) {
  const order = await getOrderForRecalc(orderId, tx);
  const seatTotal = order.tickets.reduce((sum, s) => sum + s.price, 0);
  const comboTotal = order.combos.reduce((sum, c) => sum + c.quantity * c.unitPrice, 0);
  const subtotal = seatTotal + comboTotal;

  let promotionId = order.promotionId;
  let discount = 0;
  if (order.promotion) {
    try {
      await assertPromotionUsable({ promotion: order.promotion, userId: order.userId, subtotal, orderId, db: tx });
      discount = calcDiscount(order.promotion, subtotal);
    } catch (err) {
      if (err.code !== 'PROMO_INVALID') throw err;
      promotionId = null; // gỡ mã
    }
  }
  await updateOrderTotals(orderId, { seatTotal, comboTotal, discount, promotionId, total: subtotal - discount }, tx);
}

/**
 * Chạy `work(tx)` trong transaction trên MỘT ĐƠN còn PENDING và còn hạn của chính user.
 * Câu cập nhật có điều kiện đầu tiên vừa kiểm tra trạng thái, vừa KHÓA dòng đơn: nếu IPN thanh toán / hủy đơn
 * xảy ra cùng lúc thì một bên phải chờ bên kia xong, không ai ghi chồng lên ai.
 */
async function withPendingOrder({ userId, orderId }, work) {
  const order = await getOrderOwner(orderId);
  if (!order) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy đơn hàng.' });
  if (order.userId !== userId) throw new AppError('FORBIDDEN');

  await runInTransaction(async (tx) => {
    const count = await touchPendingOrder({ orderId, now: new Date() }, tx);
    if (count === 0) {
      const now = await findOrderStatus(orderId, tx);
      throw new AppError(now.status === 'PENDING' ? 'ORDER_EXPIRED' : 'ORDER_NOT_PENDING');
    }
    await work(tx);
    await recalcOrder(tx, orderId);
  }, TX_OPTIONS);
  return getOrder({ userId, orderId });
}

/**
 * Chọn combo bắp nước: THAY CẢ DANH SÁCH (`[]` = bỏ hết). Giá combo được chốt vào đơn lúc này (BR-14).
 * @param {{ userId: string, orderId: string, items: Array<{ comboId: string, quantity: number }> }} params
 * @returns {Promise<object>} `Order` với tổng tiền mới
 * @throws {AppError} NOT_FOUND | FORBIDDEN | ORDER_EXPIRED | ORDER_NOT_PENDING | VALIDATION_ERROR
 */
export async function setCombos({ userId, orderId, items }) {
  const fieldError = (message) => new AppError('VALIDATION_ERROR', { details: { fields: { items: message } } });
  if (new Set(items.map((i) => i.comboId)).size !== items.length) throw fieldError('Mỗi combo chỉ xuất hiện một lần.');
  if (items.some((i) => !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > MAX_COMBO_QTY)) {
    throw fieldError(`Số lượng mỗi combo từ 1 đến ${MAX_COMBO_QTY}.`);
  }
  const combos = await comboService.getActiveCombos(items.map((i) => i.comboId));
  if (combos.length !== items.length) throw fieldError('Có combo không tồn tại hoặc đã ngừng bán.');
  const priceOf = new Map(combos.map((c) => [c.id, c.price]));

  return withPendingOrder({ userId, orderId }, async (tx) => {
    await deleteCombosOfOrder(orderId, tx);
    if (items.length) {
      await insertOrderCombos({ orderId, items: items.map((i) => ({ comboId: i.comboId, quantity: i.quantity, unitPrice: priceOf.get(i.comboId) })) }, tx);
    }
  });
}

/**
 * Áp một mã khuyến mãi (mỗi đơn 1 mã — mã mới thay mã cũ, BR-23). Lượt dùng chưa bị trừ (chỉ trừ khi thanh toán, BR-24).
 * @param {{ userId: string, orderId: string, code: string }} params
 * @returns {Promise<object>} `Order` đã giảm giá
 * @throws {AppError} PROMO_INVALID (details.reason) | NOT_FOUND | FORBIDDEN | ORDER_EXPIRED | ORDER_NOT_PENDING
 */
export async function applyPromotion({ userId, orderId, code }) {
  return withPendingOrder({ userId, orderId }, async (tx) => {
    const order = await getOrderLines(orderId, tx);
    const subtotal = order.tickets.reduce((s, x) => s + x.price, 0) + order.combos.reduce((s, c) => s + c.quantity * c.unitPrice, 0);
    const promotion = await findPromotionByCode({ code, db: tx });
    await assertPromotionUsable({ promotion, userId, subtotal, orderId, db: tx });
    await setOrderPromotion(orderId, promotion.id, tx);
  });
}

/**
 * Gỡ mã khuyến mãi khỏi đơn.
 * @param {{ userId: string, orderId: string }} params
 * @returns {Promise<object>} `Order`
 */
export function removePromotion({ userId, orderId }) {
  return withPendingOrder({ userId, orderId }, (tx) => setOrderPromotion(orderId, null, tx));
}


// ---------------------------------------------------------------------------------------------
// Dành cho payment.service: đọc / chuyển trạng thái đơn mà payment không được tự đụng vào order.dao.
// ---------------------------------------------------------------------------------------------

const POINT_UNIT = 10_000; // BR-25 (Could): 1 điểm / 10.000đ thực trả

/**
 * Đơn có thể thanh toán: đúng chủ, còn PENDING và còn hạn giữ ghế. Payment gọi trước khi tạo giao dịch.
 * @param {{ userId: string, orderId: string, now?: Date }} params
 * @returns {Promise<object>} dòng Order
 * @throws {AppError} NOT_FOUND | FORBIDDEN | ORDER_NOT_PENDING | ORDER_EXPIRED
 */
export async function getPayableOrder({ userId, orderId, now = new Date() }) {
  const order = await getOrderById(orderId);
  if (!order) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy đơn hàng.' });
  if (order.userId !== userId) throw new AppError('FORBIDDEN');
  if (order.status !== 'PENDING') throw new AppError('ORDER_NOT_PENDING');
  if (order.expiresAt <= now) throw new AppError('ORDER_EXPIRED');
  return order;
}

/**
 * Chủ đơn và trạng thái đơn (trang kết quả thanh toán chỉ ĐỌC, không đổi gì).
 * @param {{ orderId: string }} params
 * @returns {Promise<{ userId: string, status: string }|null>} null nếu không có đơn
 */
export async function getOrderStatus({ orderId }) {
  const order = await getOrderById(orderId);
  return order ? { userId: order.userId, status: order.status } : null;
}

/**
 * ⭐ Ghi nhận đơn ĐÃ THANH TOÁN khi IPN thành công — NƠI DUY NHẤT đưa đơn sang PAID. Gọi trong transaction của payment (truyền `tx`);
 * lỗi Prisma P2002 (ghế đã thuộc vé khác, IPN đến muộn) đi xuyên ra ngoài để payment ROLLBACK và chuyển đơn sang REFUND_PENDING.
 * @param {{ orderId: string, amount: number, now: Date }} params `amount`: số tiền đã thu (VND)
 * @param {object} [db]
 * @returns {Promise<void>}
 */
export async function markPaid({ orderId, amount, now }, db) {
  const order = await getOrderById(orderId, db);
  // Chỉ đơn PENDING/EXPIRED/CANCELLED mới đi tiếp. Đơn đã PAID/REFUND_*: giao dịch này là khoản thu thừa,
  // chỉ ghi nhận SUCCESS (đã làm ở payment), admin xử lý hoàn tiền thủ công.
  if (!['PENDING', 'EXPIRED', 'CANCELLED'].includes(order.status)) return;

  // Số tiền đã thu phải KHỚP tổng đơn hiện tại. Khách tạo link thanh toán rồi đổi combo/mã giảm giá thì tổng đổi;
  // trả theo link cũ sẽ thu sai số tiền => KHÔNG ghi PAID. Ghi nhận khoản thu, nhả vé, chờ admin hoàn tiền.
  if (order.total !== amount) {
    await ticketService.releaseTicketsOfOrders([orderId], db);
    await setOrderStatus(orderId, 'REFUND_PENDING', db);
    return;
  }

  await ticketService.sellTicketsOfOrder({ orderId, now }, db); // vé -> SOLD (P2002 đi xuyên ra ngoài)
  await markOrderPaid(orderId, now, db);
  if (order.promotionId) await recordUsage(order.promotionId, db); // BR-24
  const points = Math.floor(order.total / POINT_UNIT); // BR-25
  if (points > 0) await userService.addPoints({ userId: order.userId, points }, db);
}

/**
 * Đơn chờ hoàn tiền (BR-31): thanh toán đã thu nhưng ghế không còn / số tiền lệch. Gọi trong transaction của payment.
 * @param {string} orderId
 * @param {object} [db]
 * @returns {Promise<object>} Order sau khi đổi
 */
export const markRefundPending = (orderId, db) => setOrderStatus(orderId, 'REFUND_PENDING', db);

// ---------------------------------------------------------------------------------------------
// Soát vé (UC13, UC14) — thao tác của nhân viên trên Order đã thanh toán (chuyển từ ticket.service cũ).
// ---------------------------------------------------------------------------------------------

const WINDOW_MS = 30 * 60_000; // BR-34: từ 30 phút trước đến 30 phút sau giờ bắt đầu

const findByCode = (code) => findOrderByCode(normalizeTicketCode(code));

/**
 * Vé này có vào rạp được không, và nếu không thì vì sao? (hàm thuần — một chỗ duy nhất quyết định luật check-in)
 * Thứ tự kiểm tra: chưa trả tiền -> đã dùng -> suất bị hủy -> ngoài khung giờ. Suất đọc ở `order.tickets[0].showtime`.
 * @param {{ status: string, checkedInAt: Date|null, tickets: Array<{ showtime: { startTime: Date, status: string } }> }} order
 * @param {Date} now
 * @returns {{ canCheckIn: true } | { canCheckIn: false, reason: 'NOT_PAID'|'ALREADY_USED'|'SHOWTIME_CANCELLED'|'TOO_EARLY'|'TOO_LATE' }}
 */
export function evaluateCheckIn(order, now) {
  if (order.status !== 'PAID') return { canCheckIn: false, reason: 'NOT_PAID' };
  if (order.checkedInAt) return { canCheckIn: false, reason: 'ALREADY_USED' };
  const { showtime } = order.tickets[0];
  if (showtime.status !== 'OPEN') return { canCheckIn: false, reason: 'SHOWTIME_CANCELLED' };
  const delta = now.getTime() - showtime.startTime.getTime(); // âm = chưa tới giờ chiếu
  if (delta < -WINDOW_MS) return { canCheckIn: false, reason: 'TOO_EARLY' };
  if (delta > WINDOW_MS) return { canCheckIn: false, reason: 'TOO_LATE' };
  return { canCheckIn: true };
}

/**
 * Tra cứu vé bằng mã (UC13) để nhân viên xem trước khi cho vào.
 * @param {{ code: string, now?: Date }} params code nhận cả mã trần lẫn nội dung QR "CINEMIND:<mã>"
 * @returns {Promise<{ order: object, canCheckIn: boolean, reason?: string }>}
 * @throws {AppError} NOT_FOUND
 */
export async function lookupForCheckIn({ code, now = new Date() }) {
  const order = await findByCode(code);
  if (!order) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy vé.' });
  return { order: toOrderDto(order), ...evaluateCheckIn(order, now) };
}

/**
 * Check-in vé (UC14): đánh dấu cả đơn đã vào rạp (BR-33: 1 QR cho cả đơn).
 * Mỗi vé chỉ dùng được MỘT lần, kể cả khi hai nhân viên quét cùng lúc: việc "đánh dấu đã dùng" là MỘT câu lệnh
 * cập nhật có điều kiện `checkedInAt IS NULL`, nên chỉ một người thắng — giống ý tưởng "để DB làm trọng tài".
 * @param {{ code: string, staffId: string, now?: Date }} params staffId lấy từ token
 * @returns {Promise<object>} `Order` có `checkedInAt`
 * @throws {AppError} NOT_FOUND | TICKET_NOT_PAID | TICKET_ALREADY_USED | CHECKIN_NOT_ALLOWED
 */
export async function checkIn({ code, staffId, now = new Date() }) {
  const order = await findByCode(code);
  if (!order) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy vé.' });

  const verdict = evaluateCheckIn(order, now);
  if (!verdict.canCheckIn) throw checkInError(verdict.reason, order);

  const count = await checkInIfNotUsed({ orderId: order.id, staffId, now });
  if (count === 0) {
    // Có người vừa quét trước ta: đọc lại để báo họ quét lúc nào.
    throw checkInError('ALREADY_USED', await getOrderById(order.id));
  }
  return toOrderDto(await getOrderDetail(order.id));
}

function checkInError(reason, order) {
  switch (reason) {
    case 'NOT_PAID':
      return new AppError('TICKET_NOT_PAID');
    case 'ALREADY_USED':
      return new AppError('TICKET_ALREADY_USED', {
        message: `Vé đã được sử dụng lúc ${vnTime(order.checkedInAt)}.`,
        details: { checkedInAt: order.checkedInAt },
      });
    default: // TOO_EARLY | TOO_LATE | SHOWTIME_CANCELLED
      return new AppError('CHECKIN_NOT_ALLOWED', { details: { reason } });
  }
}

/** "HH:mm" theo giờ Việt Nam cho thông báo hiển thị cho nhân viên. */
function vnTime(date) {
  const d = new Date(date.getTime() + 7 * 3600_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
