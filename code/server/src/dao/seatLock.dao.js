import { prisma } from '../config/prisma.js';

/** Mọi lượt giữ / bán ghế của một suất (trạng thái + hạn). */
export const getLocksOfShowtime = (showtimeId, db = prisma) =>
  db.seatLock.findMany({ where: { showtimeId }, select: { seatId: true, status: true, expiresAt: true } });

/**
 * Số ghế ĐANG BỊ CHIẾM (đã bán, hoặc giữ còn hạn) của mỗi suất. Lượt giữ quá hạn KHÔNG tính (dọn lười).
 * @returns {Promise<Array<{ showtimeId: string, _count: { _all: number } }>>}
 */
export const countTakenLocksByShowtime = ({ showtimeIds, now }, db = prisma) =>
  db.seatLock.groupBy({
    by: ['showtimeId'],
    where: { showtimeId: { in: showtimeIds }, OR: [{ status: 'SOLD' }, { expiresAt: { gt: now } }] },
    _count: { _all: true },
  });

/**
 * Xóa mọi lượt giữ / bán của các đơn đã cho (nhả ghế khi hủy đơn).
 * @returns {Promise<{ count: number }>}
 */
export const deleteLocksOfOrders = (orderIds, db = prisma) => db.seatLock.deleteMany({ where: { orderId: { in: orderIds } } });

/** Xóa mọi lượt giữ / bán của MỘT đơn. */
export const deleteLocksOfOrder = (orderId, db = prisma) => db.seatLock.deleteMany({ where: { orderId } });

/** Xóa các lượt giữ còn ở trạng thái HELD của một đơn (dọn đơn hết hạn; ghế SOLD không đụng tới). */
export const deleteHeldLocksOfOrder = (orderId, db = prisma) => db.seatLock.deleteMany({ where: { orderId, status: 'HELD' } });

/**
 * "Dọn lười": xóa lượt giữ ĐÃ QUÁ HẠN của đúng các ghế đang xin, để INSERT sau đó không vướng khóa chính.
 * @param {{ showtimeId: string, seatIds: string[], now: Date, exceptOrderId?: string }} params
 *   `exceptOrderId`: không xóa lượt giữ của đơn này (khi xác nhận thanh toán chỉ dọn lượt của NGƯỜI KHÁC)
 */
export const deleteExpiredHeldLocks = ({ showtimeId, seatIds, now, exceptOrderId }, db = prisma) =>
  db.seatLock.deleteMany({
    where: {
      showtimeId, seatId: { in: seatIds }, status: 'HELD', expiresAt: { lte: now },
      ...(exceptOrderId && { orderId: { not: exceptOrderId } }),
    },
  });

/**
 * ⭐ TRỌNG TÀI chống trùng ghế: chèn TẤT CẢ lượt giữ trong MỘT câu lệnh. Khóa chính (showtimeId, seatId) của PostgreSQL
 * cho đúng một người thắng mỗi ghế; trùng ghế nào => lỗi P2002 (đi xuyên qua DAO) => service ROLLBACK cả transaction.
 * TUYỆT ĐỐI không dùng `skipDuplicates`: nó lặng lẽ bỏ ghế trùng và gây bán trùng. Phải gọi với `tx` của transaction giữ ghế.
 * @param {{ showtimeId: string, seatIds: string[], orderId: string, expiresAt: Date }} params
 */
export const insertHeldLocks = ({ showtimeId, seatIds, orderId, expiresAt }, db = prisma) =>
  db.seatLock.createMany({
    data: seatIds.map((seatId) => ({ showtimeId, seatId, orderId, status: 'HELD', expiresAt })),
  });

/**
 * Các ghế (trong danh sách) đang bị người khác giữ còn hạn hoặc đã mua, kèm hàng + số ghế.
 * @returns {Promise<Array<{ seatId: string, seat: { row: string, number: number } }>>}
 */
export const findTakenLocks = ({ showtimeId, seatIds, now }, db = prisma) =>
  db.seatLock.findMany({
    where: { showtimeId, seatId: { in: seatIds }, OR: [{ status: 'SOLD' }, { expiresAt: { gt: now } }] },
    include: { seat: { select: { row: true, number: true } } },
  });

/**
 * Chuyển lượt giữ CỦA ĐƠN NÀY sang đã bán (SOLD, hết hạn = null).
 * @returns {Promise<number>} 1 nếu còn lượt giữ để chuyển, 0 nếu đã mất (cron đã dọn / đơn đã hết hạn)
 */
export const markLockSold = async ({ showtimeId, seatId, orderId }, db = prisma) =>
  (await db.seatLock.updateMany({ where: { showtimeId, seatId, orderId }, data: { status: 'SOLD', expiresAt: null } })).count;

/**
 * ⭐ Chèn lượt bán mới khi lượt giữ đã mất. Nếu ghế đã thuộc người khác thì khóa chính (showtimeId, seatId) báo P2002
 * (đi xuyên DAO) và service ROLLBACK — đây là cách không bao giờ bán trùng ghế khi IPN đến muộn.
 */
export const insertSoldLock = ({ showtimeId, seatId, orderId }, db = prisma) =>
  db.seatLock.create({ data: { showtimeId, seatId, orderId, status: 'SOLD' } });
