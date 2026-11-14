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
