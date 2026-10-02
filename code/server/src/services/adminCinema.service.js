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

const fieldError = (field, message) => new AppError('VALIDATION_ERROR', { details: { fields: { [field]: message } } });
const cinemaInclude = { city: { select: { id: true, name: true } } };
const toAdminCinema = (c, rooms = []) => ({
  id: c.id, name: c.name, address: c.address, phone: c.phone, isActive: c.isActive, city: c.city, rooms,
});

async function assertCityExists(cityId) {
  const city = await prisma.city.findUnique({ where: { id: cityId }, select: { id: true } });
  if (!city) throw fieldError('cityId', 'Không tìm thấy thành phố.');
}

/**
 * Tạo rạp. Phòng và sơ đồ ghế không tạo ở đây (nạp bằng seed), nên rạp mới có `rooms: []`.
 * @param {{ cityId: string, name: string, address: string, phone?: string|null, isActive?: boolean }} params
 * @returns {Promise<object>} rạp vừa tạo (dạng phần tử của listAdminCinemas)
 * @throws {AppError} VALIDATION_ERROR (cityId không tồn tại)
 */
export async function createCinema({ cityId, name, address, phone, isActive }) {
  await assertCityExists(cityId);
  const created = await prisma.cinema.create({
    data: { cityId, name, address, phone: phone ?? null, ...(isActive !== undefined && { isActive }) },
    include: cinemaInclude,
  });
  return toAdminCinema(created);
}

/** Rạp có suất CHƯA chiếu, còn mở, đã có người mua/giữ vé không? (cùng định nghĩa "đã bán" với sửa/hủy suất) */
async function hasUpcomingSales(cinemaId) {
  const n = await prisma.order.count({
    where: {
      showtime: { status: 'OPEN', startTime: { gt: new Date() }, room: { cinemaId } },
      OR: [{ status: { in: ['PAID', 'REFUND_PENDING'] } }, { status: 'PENDING', expiresAt: { gt: new Date() } }],
    },
  });
  return n > 0;
}

/**
 * Sửa rạp (một phần). Tắt rạp (`isActive: false`) khi còn suất sắp chiếu đã có người mua/giữ vé -> RESOURCE_IN_USE:
 * nếu không, khách đã trả tiền sẽ đến một rạp biến mất khỏi hệ thống.
 * @param {{ cinemaId: string, cityId?: string, name?: string, address?: string, phone?: string|null, isActive?: boolean }} params
 * @returns {Promise<object>} rạp sau khi sửa
 * @throws {AppError} NOT_FOUND | VALIDATION_ERROR | RESOURCE_IN_USE
 */
export async function updateCinema({ cinemaId, ...changes }) {
  const current = await prisma.cinema.findUnique({ where: { id: cinemaId }, select: { id: true, isActive: true } });
  if (!current) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy rạp.' });
  if (changes.cityId) await assertCityExists(changes.cityId);
  if (changes.isActive === false && current.isActive && (await hasUpcomingSales(cinemaId))) {
    throw new AppError('RESOURCE_IN_USE', { message: 'Rạp còn suất sắp chiếu đã có người đặt vé. Hãy hủy / hoàn tiền các đơn đó trước khi tắt rạp.' });
  }
  await prisma.cinema.update({ where: { id: cinemaId }, data: changes });
  const [cinema] = (await listAdminCinemas()).filter((c) => c.id === cinemaId);
  return cinema;
}
