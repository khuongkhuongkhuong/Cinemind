import { prisma } from '../config/prisma.js';

// Service phụ trách thực thể Ticket (docs/04 mục 5.2). Hàm nhận tham số cuối `db` được GỌI TRONG transaction của service khác:
// truyền `tx` vào đó; không truyền thì dùng kết nối mặc định.

/**
 * Trạng thái các ghế đang bị chiếm của một suất. Vé HELD của đơn đã quá hạn coi như ghế trống ("dọn lười").
 * @param {{ showtimeId: string, now?: Date }} params
 * @returns {Promise<Map<string, 'HELD'|'SOLD'>>} seatId -> trạng thái (ghế không có trong Map là trống)
 */
export async function getSeatStatuses({ showtimeId, now = new Date() }) {
  const rows = await listOccupiedTicketsOfShowtime(showtimeId);
  const map = new Map();
  for (const t of rows) {
    if (t.status === 'SOLD') map.set(t.seatId, 'SOLD');
    else if (t.order.expiresAt > now) map.set(t.seatId, 'HELD'); // HELD quá hạn = trống
  }
  return map;
}

/**
 * Số ghế đang bị chiếm (SOLD hoặc HELD còn hạn) của mỗi suất.
 * @param {{ showtimeIds: string[], now?: Date }} params
 * @returns {Promise<Map<string, number>>} showtimeId -> số ghế (suất không có ghế bị chiếm thì không có trong Map)
 */
export async function countTakenSeatsByShowtime({ showtimeIds, now = new Date() }) {
  const counts = new Map();
  for (const { showtimeId } of await listTakenTicketShowtimeIds({ showtimeIds, now })) counts.set(showtimeId, (counts.get(showtimeId) ?? 0) + 1);
  return counts;
}

/**
 * ⭐ Giữ ghế cho đơn: dọn lười vé quá hạn trên các ghế này rồi chèn TẤT CẢ vé trong một câu lệnh (P2002 nếu trùng ghế).
 * Gọi trong transaction của order.service (truyền `tx`).
 * @param {{ orderId: string, showtimeId: string, seats: Array<{ seatId: string, seatLabel: string, seatType: string, price: number }>, now: Date }} params
 * @param {object} [db]
 * @returns {Promise<void>}
 * @throws lỗi Prisma P2002 khi một ghế đã thuộc vé khác (service gọi dịch sang SEAT_UNAVAILABLE)
 */
export async function holdTickets({ orderId, showtimeId, seats, now }, db) {
  const seatIds = seats.map((s) => s.seatId);
  await releaseExpiredHeldTickets({ showtimeId, seatIds, now }, db);
  await insertTickets(seats.map((s) => ({ orderId, showtimeId, ...s })), db);
}

/**
 * Ghế (trong danh sách) đang bị người khác chiếm — để báo ghế nào vừa bị lấy.
 * @param {{ showtimeId: string, seatIds: string[], now?: Date }} params
 * @returns {Promise<Array<{ seatId: string, label: string }>>}
 */
export async function findTakenSeats({ showtimeId, seatIds, now = new Date() }) {
  return (await findTakenTickets({ showtimeId, seatIds, now })).map((t) => ({ seatId: t.seatId, label: t.seatLabel }));
}

/**
 * Nhả vé HELD của các đơn (hủy đơn, BR-03, hết hạn, lệch tiền). Vé vẫn còn làm lịch sử, chỉ chuyển sang RELEASED.
 * @param {string[]} orderIds
 * @param {object} [db]
 * @returns {Promise<number>} số vé đã nhả
 */
export const releaseTicketsOfOrders = async (orderIds, db = prisma) =>
  (await db.ticket.updateMany({
    where: { orderId: { in: orderIds }, status: 'HELD' },
    data: { status: 'RELEASED', occupiedSeatId: null },
  })).count;

/**
 * ⭐ Bán mọi vé của đơn (IPN). Ném P2002 nếu một ghế đã thuộc vé khác — người gọi ROLLBACK và chuyển đơn sang REFUND_PENDING.
 * @param {{ orderId: string, now: Date }} params
 * @param {object} [db]
 * @returns {Promise<void>}
 */
export async function sellTicketsOfOrder({ orderId, now }, db) {
  const tickets = await listTicketsOfOrder(orderId, db);
  if (tickets.length === 0) return; // đơn không có vé (không xảy ra với đơn tạo qua holdSeats)
  const { showtimeId } = tickets[0]; // mọi vé của một đơn cùng một suất
  // Nhả vé HELD quá hạn của NGƯỜI KHÁC trên các ghế của đơn, để vé của đơn này chiếm lại được (IPN đến muộn).
  await releaseExpiredHeldTickets({ showtimeId, seatIds: tickets.map((t) => t.seatId), now, exceptOrderId: orderId }, db);
  for (const t of tickets) await markTicketSold({ ticketId: t.id, seatId: t.seatId }, db);
}

/**
 * Suất đã có người mua / giữ chưa (không cho sửa / hủy suất)?
 * @param {{ showtimeId: string, now?: Date }} params
 * @param {object} [db]
 * @returns {Promise<boolean>}
 */
export async function hasActiveSales({ showtimeId, now = new Date() }, db) {
  return (await countActiveSalesOfShowtime({ showtimeId, now }, db)) > 0;
}

/**
 * Trong các suất đã cho, có vé nào đang được mua / giữ không? (cùng định nghĩa với `hasActiveSales`)
 * @param {{ showtimeIds: string[], now?: Date }} params
 * @param {object} [db]
 * @returns {Promise<boolean>}
 */
export async function hasActiveSalesInShowtimes({ showtimeIds, now = new Date() }, db) {
  return (await countActiveSalesOfShowtime({ showtimeId: { in: showtimeIds }, now }, db)) > 0;
}

// =============================================================================================
// TRUY VẤN NỘI BỘ (@internal) — bảng Ticket. Mỗi hàm MỘT thao tác đọc / ghi; chỉ file này gọi chúng (docs/04 v1.26).
// Tham số cuối `db = prisma`: truyền `tx` khi chạy trong transaction. Lỗi CSDL (vd P2002) đi xuyên ra cho hàm nghiệp vụ xử lý.
// =============================================================================================

// Vé "đang chiếm ghế" = SOLD, hoặc HELD mà đơn còn hạn. Vé HELD của đơn quá hạn coi như ghế trống (dọn lười).
const takenWhere = (now) => ({ OR: [{ status: 'SOLD' }, { status: 'HELD', order: { expiresAt: { gt: now } } }] });

/**
 * Vé còn giữ chỗ (HELD/SOLD, kể cả HELD đã quá hạn) của một suất, kèm hạn của đơn — cho sơ đồ ghế.
 * @internal
 * @returns {Promise<Array<{ seatId: string, status: string, order: { expiresAt: Date } }>>}
 */
export const listOccupiedTicketsOfShowtime = (showtimeId, db = prisma) =>
  db.ticket.findMany({
    where: { showtimeId, occupiedSeatId: { not: null } },
    select: { seatId: true, status: true, order: { select: { expiresAt: true } } },
  });

/**
 * showtimeId của mọi vé đang chiếm ghế trong các suất (service tự đếm theo suất). @returns {Promise<Array<{ showtimeId: string }>>}
 * @internal
 */
export const listTakenTicketShowtimeIds = ({ showtimeIds, now }, db = prisma) =>
  db.ticket.findMany({ where: { showtimeId: { in: showtimeIds }, ...takenWhere(now) }, select: { showtimeId: true } });

/**
 * Vé đang chiếm các ghế đã cho (để báo ghế nào vừa bị lấy). @returns {Promise<Array<{ seatId: string, seatLabel: string }>>}
 * @internal
 */
export const findTakenTickets = ({ showtimeId, seatIds, now }, db = prisma) =>
  db.ticket.findMany({ where: { showtimeId, seatId: { in: seatIds }, ...takenWhere(now) }, select: { seatId: true, seatLabel: true } });

/**
 * ⭐ TRỌNG TÀI chống trùng ghế: chèn TẤT CẢ vé của đơn trong MỘT câu lệnh, trạng thái HELD, occupiedSeatId = seatId.
 * UNIQUE (showtimeId, occupiedSeatId) cho đúng một người thắng mỗi ghế; trùng => P2002 (đi xuyên hàm truy vấn) => service ROLLBACK.
 * TUYỆT ĐỐI không dùng skipDuplicates.
 * @internal
 * @param {Array<{ orderId: string, showtimeId: string, seatId: string, seatLabel: string, seatType: string, price: number }>} rows
 * @returns {Promise<{ count: number }>}
 */
export const insertTickets = (rows, db = prisma) =>
  db.ticket.createMany({ data: rows.map((r) => ({ ...r, status: 'HELD', occupiedSeatId: r.seatId })) });

/**
 * ⭐ Dọn lười: nhả vé HELD của ĐƠN ĐÃ QUÁ HẠN trên đúng các ghế đang xin, để insertTickets không vướng UNIQUE.
 * Viết bằng MỘT câu UPDATE … FROM có điều kiện `status = 'HELD'` trên chính dòng vé: nếu IPN vừa chuyển vé đó sang SOLD,
 * PostgreSQL kiểm lại điều kiện trên dòng mới và KHÔNG nhả nhầm vé đã bán. (Không dùng updateMany với điều kiện quan hệ
 * `order: {...}` vì Prisma có thể sinh câu lệnh con đọc lại bảng Ticket bằng ảnh chụp cũ.)
 * ⚠ Múi giờ: cột `Order.expiresAt` là `timestamp` (không múi giờ, Prisma lưu giờ UTC). Truyền `Date` thẳng vào SQL thô thì Postgres coi nó là
 * `timestamptz` rồi đổi theo múi giờ của PHIÊN, làm so sánh lệch vài giờ (vé HELD còn hạn bị nhả nhầm). Vì vậy truyền chuỗi ISO rồi ép `::timestamp`
 * (ép chuỗi có 'Z' sang `timestamp` giữ nguyên giờ UTC), cho kết quả đúng với mọi múi giờ của máy chủ CSDL.
 * @internal
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
      AND o."expiresAt" <= ${now.toISOString()}::timestamp
      AND (${exceptOrderId}::uuid IS NULL OR t."orderId" <> ${exceptOrderId}::uuid)`;

/**
 * Vé của một đơn (để bán khi IPN). @returns {Promise<Array<{ id: string, showtimeId: string, seatId: string, status: string }>>}
 * @internal
 */
export const listTicketsOfOrder = (orderId, db = prisma) =>
  db.ticket.findMany({ where: { orderId }, select: { id: true, showtimeId: true, seatId: true, status: true } });

/**
 * ⭐ Bán một vé: SOLD + occupiedSeatId = seatId. Vé đang HELD chỉ đổi trạng thái; vé đã RELEASED (đơn từng hết hạn) chiếm lại ghế —
 * nếu ghế đã thuộc vé khác thì UNIQUE báo P2002 và service ROLLBACK (IPN đến muộn, BR-31).
 * @internal
 * @returns {Promise<object>} Ticket sau khi cập nhật
 */
export const markTicketSold = ({ ticketId, seatId }, db = prisma) =>
  db.ticket.update({ where: { id: ticketId }, data: { status: 'SOLD', occupiedSeatId: seatId } });

/**
 * Số vé "đã có người mua / giữ" của suất (không cho sửa / hủy suất): SOLD, HELD còn hạn, hoặc thuộc đơn REFUND_PENDING.
 * @internal
 * @returns {Promise<number>}
 */
export const countActiveSalesOfShowtime = ({ showtimeId, now }, db = prisma) =>
  db.ticket.count({ where: { showtimeId, OR: [...takenWhere(now).OR, { order: { status: 'REFUND_PENDING' } }] } });
