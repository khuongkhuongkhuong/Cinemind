import { prisma } from '../config/prisma.js';

// Vé "đang chiếm ghế" = SOLD, hoặc HELD mà đơn còn hạn. Vé HELD của đơn quá hạn coi như ghế trống (dọn lười).
const takenWhere = (now) => ({ OR: [{ status: 'SOLD' }, { status: 'HELD', order: { expiresAt: { gt: now } } }] });

/**
 * Vé còn giữ chỗ (HELD/SOLD, kể cả HELD đã quá hạn) của một suất, kèm hạn của đơn — cho sơ đồ ghế.
 * @returns {Promise<Array<{ seatId: string, status: string, order: { expiresAt: Date } }>>}
 */
export const listOccupiedTicketsOfShowtime = (showtimeId, db = prisma) =>
  db.ticket.findMany({
    where: { showtimeId, occupiedSeatId: { not: null } },
    select: { seatId: true, status: true, order: { select: { expiresAt: true } } },
  });

/** showtimeId của mọi vé đang chiếm ghế trong các suất (service tự đếm theo suất). @returns {Promise<Array<{ showtimeId: string }>>} */
export const listTakenTicketShowtimeIds = ({ showtimeIds, now }, db = prisma) =>
  db.ticket.findMany({ where: { showtimeId: { in: showtimeIds }, ...takenWhere(now) }, select: { showtimeId: true } });

/** Vé đang chiếm các ghế đã cho (để báo ghế nào vừa bị lấy). @returns {Promise<Array<{ seatId: string, seatLabel: string }>>} */
export const findTakenTickets = ({ showtimeId, seatIds, now }, db = prisma) =>
  db.ticket.findMany({ where: { showtimeId, seatId: { in: seatIds }, ...takenWhere(now) }, select: { seatId: true, seatLabel: true } });

/**
 * ⭐ TRỌNG TÀI chống trùng ghế: chèn TẤT CẢ vé của đơn trong MỘT câu lệnh, trạng thái HELD, occupiedSeatId = seatId.
 * UNIQUE (showtimeId, occupiedSeatId) cho đúng một người thắng mỗi ghế; trùng => P2002 (đi xuyên DAO) => service ROLLBACK.
 * TUYỆT ĐỐI không dùng skipDuplicates.
 * @param {Array<{ orderId: string, showtimeId: string, seatId: string, seatLabel: string, seatType: string, price: number }>} rows
 * @returns {Promise<{ count: number }>}
 */
export const insertTickets = (rows, db = prisma) =>
  db.ticket.createMany({ data: rows.map((r) => ({ ...r, status: 'HELD', occupiedSeatId: r.seatId })) });

/** Nhả vé HELD của các đơn (hủy đơn, BR-03, đơn hết hạn, lệch tiền). @returns {Promise<number>} số vé đã nhả */
export const releaseHeldTicketsOfOrders = async (orderIds, db = prisma) =>
  (await db.ticket.updateMany({
    where: { orderId: { in: orderIds }, status: 'HELD' },
    data: { status: 'RELEASED', occupiedSeatId: null },
  })).count;

/**
 * ⭐ Dọn lười: nhả vé HELD của ĐƠN ĐÃ QUÁ HẠN trên đúng các ghế đang xin, để insertTickets không vướng UNIQUE.
 * Viết bằng MỘT câu UPDATE … FROM có điều kiện `status = 'HELD'` trên chính dòng vé: nếu IPN vừa chuyển vé đó sang SOLD,
 * PostgreSQL kiểm lại điều kiện trên dòng mới và KHÔNG nhả nhầm vé đã bán. (Không dùng updateMany với điều kiện quan hệ
 * `order: {...}` vì Prisma có thể sinh câu lệnh con đọc lại bảng Ticket bằng ảnh chụp cũ.)
 * @param {{ showtimeId: string, seatIds: string[], now: Date, exceptOrderId?: string }} params
 * @returns {Promise<number>} số vé đã nhả
 */
export const releaseExpiredHeldTickets = ({ showtimeId, seatIds, now, exceptOrderId = null }, db = prisma) =>
  db.$executeRaw`
    UPDATE "Ticket" AS t SET "status" = 'RELEASED', "occupiedSeatId" = NULL
    FROM "Order" AS o
    WHERE t."orderId" = o."id"
      AND t."showtimeId" = ${showtimeId}::uuid
      AND t."seatId" = ANY(${seatIds}::uuid[])
      AND t."status" = 'HELD'
      AND o."expiresAt" <= ${now}
      AND (${exceptOrderId}::uuid IS NULL OR t."orderId" <> ${exceptOrderId}::uuid)`;

/** Vé của một đơn (để bán khi IPN). @returns {Promise<Array<{ id: string, showtimeId: string, seatId: string, status: string }>>} */
export const listTicketsOfOrder = (orderId, db = prisma) =>
  db.ticket.findMany({ where: { orderId }, select: { id: true, showtimeId: true, seatId: true, status: true } });

/**
 * ⭐ Bán một vé: SOLD + occupiedSeatId = seatId. Vé đang HELD chỉ đổi trạng thái; vé đã RELEASED (đơn từng hết hạn) chiếm lại ghế —
 * nếu ghế đã thuộc vé khác thì UNIQUE báo P2002 và service ROLLBACK (IPN đến muộn, BR-31).
 * @returns {Promise<object>} Ticket sau khi cập nhật
 */
export const markTicketSold = ({ ticketId, seatId }, db = prisma) =>
  db.ticket.update({ where: { id: ticketId }, data: { status: 'SOLD', occupiedSeatId: seatId } });

/**
 * Số vé "đã có người mua / giữ" của suất (không cho sửa / hủy suất): SOLD, HELD còn hạn, hoặc thuộc đơn REFUND_PENDING.
 * @returns {Promise<number>}
 */
export const countActiveSalesOfShowtime = ({ showtimeId, now }, db = prisma) =>
  db.ticket.count({ where: { showtimeId, OR: [...takenWhere(now).OR, { order: { status: 'REFUND_PENDING' } }] } });
