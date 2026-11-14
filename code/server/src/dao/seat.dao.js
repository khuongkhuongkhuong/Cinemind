import { prisma } from '../config/prisma.js';

/** Toàn bộ ghế của một phòng, theo hàng rồi số. */
export const getSeatsOfRoom = (roomId, db = prisma) => db.seat.findMany({ where: { roomId }, orderBy: [{ row: 'asc' }, { number: 'asc' }] });

/** Số ghế DÙNG ĐƯỢC (chưa hỏng) của mỗi phòng trong danh sách. @returns {Promise<Array<{ roomId: string, _count: { _all: number } }>>} */
export const countActiveSeatsByRoom = (roomIds, db = prisma) =>
  db.seat.groupBy({ by: ['roomId'], where: { roomId: { in: roomIds }, isActive: true }, _count: { _all: true } });

/** Các ghế (trong danh sách id) THUỘC phòng đã cho; ghế không thuộc phòng thì không có trong kết quả. */
export const findSeatsInRoom = ({ roomId, seatIds }, db = prisma) => db.seat.findMany({ where: { id: { in: seatIds }, roomId } });
