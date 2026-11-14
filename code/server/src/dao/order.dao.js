import { prisma } from '../config/prisma.js';

/**
 * Hình dạng "đơn đầy đủ" mà các màn hình đọc (đơn, vé, soát vé, quản trị). Nằm ở DAO vì đây là CÁCH ĐỌC dữ liệu,
 * không phải luật nghiệp vụ; service chỉ việc đổi nó sang `Order` DTO (booking.service.toOrderDto).
 */
export const ORDER_INCLUDE = {
  showtime: {
    select: {
      id: true, startTime: true, format: true, audio: true,
      movie: { select: { title: true, ageRating: true, posterUrl: true } },
      room: { select: { name: true, cinema: { select: { name: true } } } },
    },
  },
  seats: { orderBy: { seatLabel: 'asc' } },
  combos: { include: { combo: { select: { name: true } } }, orderBy: { combo: { name: 'asc' } } },
  promotion: { select: { code: true, name: true } },
};

// Soát vé cần thêm trạng thái suất để biết suất đã bị hủy hay chưa.
const TICKET_INCLUDE = {
  ...ORDER_INCLUDE,
  showtime: { select: { ...ORDER_INCLUDE.showtime.select, status: true } },
};

/**
 * Tìm đơn theo MÃ (đã chuẩn hóa) kèm dữ liệu cho soát vé (gồm trạng thái suất).
 * @param {string} code mã đơn / vé, đã qua normalizeTicketCode
 * @returns {Promise<object|null>}
 */
export const findOrderByCode = (code, db = prisma) => db.order.findUnique({ where: { code }, include: TICKET_INCLUDE });

/** Đơn thô (không kèm quan hệ). @returns {Promise<object|null>} */
export const getOrderById = (orderId, db = prisma) => db.order.findUnique({ where: { id: orderId } });

/** Đơn đầy đủ theo `ORDER_INCLUDE`. @returns {Promise<object|null>} */
export const getOrderDetail = (orderId, db = prisma) => db.order.findUnique({ where: { id: orderId }, include: ORDER_INCLUDE });

/**
 * Số đơn "đã chiếm chỗ" của suất: đã thanh toán, chờ hoàn tiền, hoặc đang chờ thanh toán còn hạn giữ ghế.
 * Có thì suất không được sửa / hủy.
 * @returns {Promise<number>}
 */
export const countActiveSalesOfShowtime = ({ showtimeId, now }, db = prisma) =>
  db.order.count({
    where: {
      showtimeId,
      OR: [{ status: { in: ['PAID', 'REFUND_PENDING'] } }, { status: 'PENDING', expiresAt: { gt: now } }],
    },
  });

/**
 * ⭐ Đánh dấu đơn ĐÃ VÀO RẠP — MỘT câu cập nhật có điều kiện (`status = PAID` và `checkedInAt IS NULL`): hai nhân viên quét
 * cùng lúc thì chỉ một người có count = 1. Service quyết định nghĩa của count = 0 (có người quét trước).
 * @param {{ orderId: string, staffId: string, now: Date }} params
 * @returns {Promise<number>} 1 nếu vừa check-in được, 0 nếu không
 */
export const checkInIfNotUsed = async ({ orderId, staffId, now }, db = prisma) =>
  (await db.order.updateMany({
    where: { id: orderId, status: 'PAID', checkedInAt: null },
    data: { checkedInAt: now, checkedInById: staffId },
  })).count;

/** Id các đơn PENDING CÒN HẠN của một user (BR-03: tạo đơn mới thì hủy các đơn này). @returns {Promise<string[]>} */
export const findActivePendingOrderIds = async ({ userId, now }, db = prisma) =>
  (await db.order.findMany({ where: { userId, status: 'PENDING', expiresAt: { gt: now } }, select: { id: true } })).map((o) => o.id);

/** Chuyển các đơn sang CANCELLED (không kiểm điều kiện: service đã chọn đúng các đơn cần hủy). */
export const markOrdersCancelled = (orderIds, db = prisma) =>
  db.order.updateMany({ where: { id: { in: orderIds } }, data: { status: 'CANCELLED' } });

/**
 * Tạo đơn kèm các dòng vé với GIÁ ĐÃ CHỐT (BR-14).
 * @param {{ code: string, userId: string, showtimeId: string, source: string, expiresAt: Date, seatTotal: number, total: number,
 *   tickets: Array<{ seatId: string, seatLabel: string, seatType: string, price: number }> }} data
 * @returns {Promise<object>} Order vừa tạo
 */
export const insertOrderWithTickets = ({ tickets, ...order }, db = prisma) =>
  db.order.create({ data: { ...order, seats: { create: tickets } } });

/** Chỉ chủ đơn. @returns {Promise<{ userId: string }|null>} */
export const getOrderOwner = (orderId, db = prisma) => db.order.findUnique({ where: { id: orderId }, select: { userId: true } });

/** Chỉ trạng thái. @returns {Promise<{ status: string }|null>} */
export const getOrderStatus = (orderId, db = prisma) => db.order.findUnique({ where: { id: orderId }, select: { status: true } });

/** Đơn đầy đủ theo MÃ (cho "vé của tôi"). @returns {Promise<object|null>} */
export const getOrderDetailByCode = (code, db = prisma) => db.order.findUnique({ where: { code }, include: ORDER_INCLUDE });

/**
 * ⭐ Hủy đơn NẾU còn PENDING và còn hạn — MỘT câu cập nhật có điều kiện: nếu IPN vừa chuyển đơn sang PAID cùng lúc thì
 * điều kiện sai, count = 0, không hủy nhầm đơn đã trả tiền.
 * @returns {Promise<number>} 1 nếu hủy được, 0 nếu không
 */
export const cancelPendingOrderIfNotExpired = async ({ orderId, now }, db = prisma) =>
  (await db.order.updateMany({ where: { id: orderId, status: 'PENDING', expiresAt: { gt: now } }, data: { status: 'CANCELLED' } })).count;

/** Id các đơn PENDING đã quá hạn (dùng index status + expiresAt), cho tác vụ dọn dẹp. @returns {Promise<string[]>} */
export const listStalePendingOrderIds = async ({ now }, db = prisma) =>
  (await db.order.findMany({ where: { status: 'PENDING', expiresAt: { lt: now } }, select: { id: true } })).map((o) => o.id);

/**
 * ⭐ Chuyển đơn sang EXPIRED NẾU vẫn PENDING và quá hạn — có điều kiện nên nếu IPN vừa xác nhận đơn này thì count = 0.
 * @returns {Promise<number>}
 */
export const markOrderExpiredIfStale = async ({ orderId, now }, db = prisma) =>
  (await db.order.updateMany({ where: { id: orderId, status: 'PENDING', expiresAt: { lt: now } }, data: { status: 'EXPIRED' } })).count;

/**
 * ⭐ "Chiếm" dòng của một đơn còn PENDING và còn hạn: cập nhật `updatedAt` trong MỘT câu có điều kiện. Câu này vừa kiểm
 * trạng thái, vừa KHÓA dòng đơn đến hết transaction: IPN thanh toán / hủy đơn cùng lúc phải chờ nhau, không ai ghi chồng lên ai.
 * @returns {Promise<number>} 1 nếu chiếm được, 0 nếu đơn không còn PENDING hoặc đã hết hạn
 */
export const touchPendingOrder = async ({ orderId, now }, db = prisma) =>
  (await db.order.updateMany({ where: { id: orderId, status: 'PENDING', expiresAt: { gt: now } }, data: { updatedAt: now } })).count;

/** Số đơn + một trang đơn của một user theo trạng thái, mới nhất trước (cho "vé của tôi"). */
export const countOrdersOfUser = ({ userId, status }, db = prisma) => db.order.count({ where: { userId, status } });

/** @param {{ userId: string, status: string }} filter @param {{ skip: number, take: number }} page */
export const findOrdersOfUser = ({ userId, status }, { skip, take }, db = prisma) =>
  db.order.findMany({
    where: { userId, status },
    orderBy: { createdAt: 'desc' },
    skip,
    take,
    select: {
      id: true, code: true, status: true, total: true, createdAt: true, paidAt: true, checkedInAt: true,
      seats: { select: { seatLabel: true }, orderBy: { seatLabel: 'asc' } },
      showtime: ORDER_INCLUDE.showtime,
    },
  });

/** Đơn kèm dòng vé, combo và khuyến mãi — để TÍNH LẠI tiền (recalcOrder). @returns {Promise<object|null>} */
export const getOrderForRecalc = (orderId, db = prisma) =>
  db.order.findUnique({ where: { id: orderId }, include: { seats: true, combos: true, promotion: true } });

/** Đơn kèm dòng vé và combo (để tính tạm tính khi áp mã). @returns {Promise<object|null>} */
export const getOrderLines = (orderId, db = prisma) => db.order.findUnique({ where: { id: orderId }, include: { seats: true, combos: true } });

/** Ghi lại các khoản tiền đã tính lại. @param {{ seatTotal: number, comboTotal: number, discount: number, promotionId: string|null, total: number }} totals */
export const updateOrderTotals = (orderId, { seatTotal, comboTotal, discount, promotionId, total }, db = prisma) =>
  db.order.update({ where: { id: orderId }, data: { seatTotal, comboTotal, discount, promotionId, total } });

/** Gắn mã khuyến mãi vào đơn (`null` = gỡ mã). */
export const setOrderPromotion = (orderId, promotionId, db = prisma) => db.order.update({ where: { id: orderId }, data: { promotionId } });
