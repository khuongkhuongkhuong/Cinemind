import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';

/**
 * Danh sách rạp kèm các phòng chiếu (và số ghế mỗi phòng) cho trang quản trị. Gồm cả rạp / phòng đã tắt.
 * Dùng để chọn phòng khi tạo suất chiếu và để xem cấu hình rạp.
 * @returns {Promise<Array<{ id: string, name: string, address: string, phone: string|null, isActive: boolean,
 *   city: { id: string, name: string }, rooms: Array<{ id: string, name: string, isActive: boolean, seatCount: number }> }>>}
 */
export async function listAdminCinemas() {
  const cinemas = await prisma.cinema.findMany({
    orderBy: [{ city: { name: 'asc' } }, { name: 'asc' }],
    include: {
      city: { select: { id: true, name: true } },
      rooms: { orderBy: { name: 'asc' }, include: { _count: { select: { seats: true } } } },
    },
  });
  return cinemas.map((c) => ({
    id: c.id, name: c.name, address: c.address, phone: c.phone, isActive: c.isActive, city: c.city,
    rooms: c.rooms.map((r) => ({ id: r.id, name: r.name, isActive: r.isActive, seatCount: r._count.seats })),
  }));
}

/**
 * Sơ đồ ghế VẬT LÝ của một phòng (không có trạng thái đặt chỗ — trạng thái là của từng suất chiếu).
 * @param {{ roomId: string }} params
 * @returns {Promise<{ room: { id: string, name: string, cinema: { id: string, name: string } }, rows: string[],
 *   seats: Array<{ id: string, row: string, number: number, label: string, type: string, pairCode: string|null, isActive: boolean }> }>}
 * @throws {AppError} NOT_FOUND
 */
export async function getRoomSeats({ roomId }) {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, name: true, cinema: { select: { id: true, name: true } } },
  });
  if (!room) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy phòng chiếu.' });
  const seats = await prisma.seat.findMany({ where: { roomId }, orderBy: [{ row: 'asc' }, { number: 'asc' }] });
  return {
    room,
    rows: [...new Set(seats.map((s) => s.row))],
    seats: seats.map((s) => ({
      id: s.id, row: s.row, number: s.number, label: `${s.row}${s.number}`, type: s.type, pairCode: s.pairCode, isActive: s.isActive,
    })),
  };
}
