// Dựng đơn trực tiếp trong test (không đi qua holdSeats). Từ docs/03 v1.3 `Order` không còn `showtimeId`: suất của đơn nằm ở VÉ,
// nên đơn dựng tay phải kèm ít nhất một vé. Trạng thái vé suy từ trạng thái đơn như hệ thống thật:
//   PENDING -> HELD (chiếm ghế) · PAID -> SOLD (chiếm ghế) · còn lại (CANCELLED, EXPIRED, REFUND_*) -> RELEASED (không chiếm ghế).
// Ghế được chọn NGẪU NHIÊN trong các ghế số 10-12 của hàng C..G: không test đặt vé nào dùng nhãn này (họ dùng A1.., B1.., D1.., F1.., G1.., H..),
// và các file test chạy song song không giành nhau; trùng (P2002) thì thử ghế khác.
import { prisma } from '../../src/config/prisma.js';

const OCCUPYING = { PENDING: 'HELD', PAID: 'SOLD' };

/** Các ghế "ít bị tranh" của phòng chiếu của suất (ghế số 10-12 của hàng C..G, còn dùng được). */
async function spareSeats(showtimeId) {
  const showtime = await prisma.showtime.findUniqueOrThrow({ where: { id: showtimeId }, select: { roomId: true } });
  let seats = await prisma.seat.findMany({ where: { roomId: showtime.roomId, isActive: true, type: { not: 'COUPLE' } }, orderBy: [{ row: 'asc' }, { number: 'asc' }] });
  if (seats.length === 0) {
    // Phòng do test tự tạo (TestRoom-...) chưa có ghế: thêm vài ghế hàng Z. Test phải xóa ghế trước khi xóa phòng.
    await prisma.seat.createMany({ data: [1, 2, 3, 4].map((number) => ({ roomId: showtime.roomId, row: 'Z', number })), skipDuplicates: true });
    seats = await prisma.seat.findMany({ where: { roomId: showtime.roomId }, orderBy: { number: 'asc' } });
  }
  const spare = seats.filter((s) => s.row >= 'C' && s.row <= 'G' && s.number >= 10);
  return spare.length ? spare : seats.slice(-6);
}

/**
 * Giống `prisma.order.create({ data })` nhưng `data.showtimeId` được chuyển thành MỘT vé của đơn.
 * @param {{ data: { showtimeId: string, status?: string, ticketStatus?: 'HELD'|'SOLD'|'RELEASED', seatId?: string, seatLabel?: string } & object }} args
 * @returns {Promise<object>} Order (không kèm quan hệ)
 */
export async function createOrder({ data }) {
  const { showtimeId, ticketStatus, seatId, seatLabel, ...order } = data;
  const status = ticketStatus ?? OCCUPYING[order.status ?? 'PENDING'] ?? 'RELEASED';
  const spare = seatId ? null : await spareSeats(showtimeId);
  for (let attempt = 0; ; attempt++) {
    const seat = seatId ? await prisma.seat.findUniqueOrThrow({ where: { id: seatId } }) : spare[Math.floor(Math.random() * spare.length)];
    try {
      return await prisma.order.create({
        data: {
          ...order,
          tickets: {
            create: [{
              showtimeId, seatId: seat.id, seatLabel: seatLabel ?? `${seat.row}${seat.number}`, seatType: seat.type, price: 0,
              status, occupiedSeatId: status === 'RELEASED' ? null : seat.id,
            }],
          },
        },
      });
    } catch (err) {
      if (err.code !== 'P2002' || seatId || attempt >= 30) throw err;
    }
  }
}
