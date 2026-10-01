import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { generateOrderCode } from '../lib/code.js';
import { calcSeatPrices, getSurcharges } from './pricing.service.js';
import { isOpenForSale } from './showtime.service.js';

const HOLD_MINUTES = 10; // BR-01: giữ ghế 10 phút, không gia hạn
const MAX_SEATS = 8; // BR-02
const MAX_ATTEMPTS = 3;
// Nhiều người giành ghế cùng lúc => transaction phải xếp hàng chờ nhau; nới thời gian chờ mặc định (2s/5s).
const TX_OPTIONS = { maxWait: 10_000, timeout: 15_000 };

const orderInclude = {
  showtime: {
    select: {
      id: true, startTime: true, format: true, audio: true,
      movie: { select: { title: true, ageRating: true, posterUrl: true } },
      room: { select: { name: true, cinema: { select: { name: true } } } },
    },
  },
  seats: { orderBy: { seatLabel: 'asc' } },
};

/** Dòng Order của Prisma -> cấu trúc `Order` dùng chung (04-api-contract mục 3.4). */
function toOrderDto(o) {
  const { showtime } = o;
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
    seats: o.seats.map((s) => ({ seatId: s.seatId, label: s.seatLabel, type: s.seatType, price: s.price })),
    combos: [],
    promotion: null,
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
  const showtime = await prisma.showtime.findUnique({ where: { id: showtimeId } });
  if (!showtime) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy suất chiếu.' });
  if (!isOpenForSale(showtime)) throw new AppError('SHOWTIME_CLOSED'); // BR-04

  if (new Set(seatIds).size !== seatIds.length) {
    throw new AppError('VALIDATION_ERROR', { details: { fields: { seatIds: 'Có ghế bị chọn trùng.' } } });
  }
  if (seatIds.length > MAX_SEATS) throw new AppError('SEAT_LIMIT_EXCEEDED'); // BR-02

  const seats = await prisma.seat.findMany({ where: { id: { in: seatIds }, roomId: showtime.roomId } });
  if (seats.length !== seatIds.length) {
    throw new AppError('NOT_FOUND', { message: 'Có ghế không thuộc phòng chiếu của suất này.' });
  }
  const broken = seats.filter((s) => !s.isActive);
  if (broken.length) {
    throw new AppError('SEAT_UNAVAILABLE', {
      details: { seatIds: broken.map((s) => s.id), seatLabels: broken.map((s) => `${s.row}${s.number}`) },
    });
  }

  // BR-05: ghế đôi phải đủ cả cặp (2 ghế cùng pairCode đều có trong lựa chọn)
  const perPair = {};
  for (const s of seats) if (s.type === 'COUPLE') perPair[s.pairCode] = (perPair[s.pairCode] ?? 0) + 1;
  if (Object.values(perPair).some((n) => n !== 2)) throw new AppError('COUPLE_SEAT_INCOMPLETE');

  // Server TỰ tính giá (BR-15); không bao giờ nhận số tiền từ client.
  const priced = calcSeatPrices({ basePrice: showtime.basePrice, surcharges: await getSurcharges(), seats });
  return { showtime, seats, priced };
}

/** Một lần thử giữ ghế — toàn bộ nằm trong MỘT transaction: hoặc tất cả thành công, hoặc không thay đổi gì. */
function runHoldTransaction({ userId, showtime, seats, priced }) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + HOLD_MINUTES * 60_000);
  const seatIds = seats.map((s) => s.id);
  const priceBySeat = new Map(priced.seats.map((p) => [p.id, p.price]));

  return prisma.$transaction(async (tx) => {
    // 1. BR-03: hủy đơn PENDING còn hạn của chính user này + nhả ghế của nó.
    //    Chỉ đơn CÒN HẠN: đơn đã quá hạn để cron chuyển EXPIRED, vì thanh toán đến muộn vẫn phải xử lý được (BR-31).
    //    Nằm TRONG transaction => nếu lần giữ mới thất bại thì rollback, đơn cũ vẫn còn nguyên.
    const old = await tx.order.findMany({
      where: { userId, status: 'PENDING', expiresAt: { gt: now } },
      select: { id: true },
    });
    if (old.length) {
      const oldIds = old.map((o) => o.id);
      await tx.seatLock.deleteMany({ where: { orderId: { in: oldIds } } });
      await tx.order.updateMany({ where: { id: { in: oldIds } }, data: { status: 'CANCELLED' } });
    }

    // 2. Dọn "lười": xóa lượt giữ ĐÃ QUÁ HẠN của đúng các ghế đang xin, để INSERT bên dưới không vướng khóa chính.
    await tx.seatLock.deleteMany({
      where: { showtimeId: showtime.id, seatId: { in: seatIds }, status: 'HELD', expiresAt: { lte: now } },
    });

    // 3. Tạo đơn + các dòng ghế với GIÁ CHỐT (BR-14).
    const order = await tx.order.create({
      data: {
        code: generateOrderCode(),
        userId,
        showtimeId: showtime.id,
        expiresAt,
        seatTotal: priced.total,
        total: priced.total,
        seats: {
          create: seats.map((s) => ({
            seatId: s.id, seatLabel: `${s.row}${s.number}`, seatType: s.type, price: priceBySeat.get(s.id),
          })),
        },
      },
    });

    // 4. ⭐ Trọng tài: chèn TẤT CẢ SeatLock trong MỘT câu lệnh. Khóa chính (showtimeId, seatId) của PostgreSQL
    //    cho đúng một người thắng mỗi ghế. Trùng ghế nào => lỗi P2002 => ROLLBACK cả transaction.
    //    TUYỆT ĐỐI không dùng skipDuplicates: nó lặng lẽ bỏ ghế trùng và gây bán trùng.
    await tx.seatLock.createMany({
      data: seatIds.map((seatId) => ({ showtimeId: showtime.id, seatId, orderId: order.id, status: 'HELD', expiresAt })),
    });

    return tx.order.findUnique({ where: { id: order.id }, include: orderInclude });
  }, TX_OPTIONS);
}

/** Sau khi thua: tra xem ghế nào đang bị người khác giữ/mua, để báo lại cho client (details của SEAT_UNAVAILABLE). */
async function findConflicts({ showtimeId, seatIds }) {
  const now = new Date();
  const locks = await prisma.seatLock.findMany({
    where: {
      showtimeId,
      seatId: { in: seatIds },
      OR: [{ status: 'SOLD' }, { expiresAt: { gt: now } }], // HELD còn hạn hoặc đã bán
    },
    include: { seat: { select: { row: true, number: true } } },
  });
  return locks.map((l) => ({ seatId: l.seatId, label: `${l.seat.row}${l.seat.number}` }));
}

/**
 * Giữ ghế và tạo đơn PENDING (hạn 10 phút). ⭐ Chống trùng ghế bằng khóa chính của SeatLock.
 * @param {{ userId: string, showtimeId: string, seatIds: string[] }} params userId lấy từ token, không từ body
 * @returns {Promise<object>} `Order` (04-api-contract mục 3.4)
 * @throws {AppError} NOT_FOUND | SHOWTIME_CLOSED | SEAT_LIMIT_EXCEEDED | COUPLE_SEAT_INCOMPLETE | SEAT_UNAVAILABLE
 */
export async function holdSeats({ userId, showtimeId, seatIds }) {
  const request = await validateRequest({ showtimeId, seatIds });

  for (let attempt = 1; ; attempt++) {
    try {
      return toOrderDto(await runHoldTransaction({ userId, ...request }));
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
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: orderInclude });
  if (!order) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy đơn hàng.' });
  if (order.userId !== userId) throw new AppError('FORBIDDEN');
  return toOrderDto(order);
}
