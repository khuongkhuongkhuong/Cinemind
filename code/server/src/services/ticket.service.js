import {
  countActiveSalesOfShowtime, findTakenTickets, insertTickets, listOccupiedTicketsOfShowtime, listTakenTicketShowtimeIds,
  listTicketsOfOrder, markTicketSold, releaseExpiredHeldTickets, releaseHeldTicketsOfOrders,
} from '../dao/ticket.dao.js';

// Service phụ trách thực thể Ticket (docs/04 mục 5.2). Hàm nhận tham số cuối `db` được GỌI TRONG transaction của service khác:
// truyền `tx` vào đó; không truyền thì DAO dùng kết nối mặc định (service không import Prisma).

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
export const releaseTicketsOfOrders = (orderIds, db) => releaseHeldTicketsOfOrders(orderIds, db);

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
