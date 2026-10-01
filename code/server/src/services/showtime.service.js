import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { VN_OFFSET_MS } from '../lib/time.js';
import { calcSeatPrices, getSurcharges } from './pricing.service.js';

const SALE_CUTOFF_MS = 15 * 60_000; // BR-04: ngừng bán online 15 phút trước giờ chiếu

/**
 * Suất còn mở bán không? (BR-04) — hàm thuần, booking.service dùng lại khi giữ ghế.
 * @param {{ status: string, startTime: Date }} showtime
 * @param {Date} [now]
 */
export const isOpenForSale = (showtime, now = new Date()) =>
  showtime.status === 'OPEN' && showtime.startTime.getTime() - now.getTime() > SALE_CUTOFF_MS;

/** "2026-10-02" (theo giờ VN) -> khoảng [00:00, 24:00) của ngày đó, tính bằng mốc UTC. */
function vnDayRange(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, d) - VN_OFFSET_MS);
  return { from, to: new Date(from.getTime() + 24 * 3600_000) };
}

const showtimeInclude = {
  movie: { select: { id: true, title: true, ageRating: true, posterUrl: true } },
  room: { select: { id: true, name: true, cinema: { select: { id: true, name: true } } } },
};

/** Dòng Prisma -> ShowtimeDetail (04-api-contract mục 3.3). */
const toDetail = (s, now) => ({
  id: s.id,
  startTime: s.startTime,
  endTime: s.endTime,
  format: s.format,
  audio: s.audio,
  isOpenForSale: isOpenForSale(s, now),
  movie: s.movie,
  cinema: s.room.cinema,
  room: { id: s.room.id, name: s.room.name },
});

/**
 * Lịch chiếu của một phim trong một ngày, nhóm theo rạp -> (định dạng, phụ đề/lồng tiếng).
 * @param {{ movieId: string, date: string, cityId: string }} params date dạng YYYY-MM-DD (giờ VN)
 * @returns {Promise<{ date: string, cinemas: object[] }>}
 * @throws {AppError} NOT_FOUND
 */
export async function listShowtimesByMovie({ movieId, date, cityId }) {
  const movie = await prisma.movie.findUnique({ where: { id: movieId }, select: { id: true } });
  if (!movie) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy phim.' });

  const { from, to } = vnDayRange(date);
  const now = new Date();
  const rows = await prisma.showtime.findMany({
    where: {
      movieId,
      status: 'OPEN',
      startTime: { gte: from, lt: to },
      room: { cinema: { cityId, isActive: true } },
    },
    orderBy: { startTime: 'asc' },
    select: {
      id: true, startTime: true, format: true, audio: true, status: true,
      room: { select: { cinema: { select: { id: true, name: true, address: true } } } },
    },
  });

  // Gom nhóm trong bộ nhớ: dữ liệu một phim / một ngày / một thành phố rất nhỏ.
  const byCinema = new Map();
  for (const s of rows) {
    const { cinema } = s.room;
    if (!byCinema.has(cinema.id)) byCinema.set(cinema.id, { cinema, groups: new Map() });
    const groups = byCinema.get(cinema.id).groups;
    const key = `${s.format}|${s.audio}`;
    if (!groups.has(key)) groups.set(key, { format: s.format, audio: s.audio, showtimes: [] });
    groups.get(key).showtimes.push({ id: s.id, startTime: s.startTime, isOpenForSale: isOpenForSale(s, now) });
  }
  return {
    date,
    cinemas: [...byCinema.values()].map(({ cinema, groups }) => ({ cinema, groups: [...groups.values()] })),
  };
}

/**
 * Chi tiết một suất chiếu.
 * @param {{ showtimeId: string }} params
 * @throws {AppError} NOT_FOUND
 */
export async function getShowtime({ showtimeId }) {
  const s = await prisma.showtime.findUnique({ where: { id: showtimeId }, include: showtimeInclude });
  if (!s) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy suất chiếu.' });
  return toDetail(s, new Date());
}

/**
 * Sơ đồ ghế của một suất, kèm trạng thái và giá từng ghế. ⭐
 * Trạng thái suy ra từ SeatLock: SOLD -> SOLD; HELD còn hạn -> HELD; HELD đã quá hạn -> AVAILABLE
 * ("dọn lười": không cần chờ cron dọn mới coi là trống).
 * @param {{ showtimeId: string }} params
 * @throws {AppError} NOT_FOUND
 */
export async function getSeatMap({ showtimeId }) {
  const showtime = await prisma.showtime.findUnique({ where: { id: showtimeId }, include: showtimeInclude });
  if (!showtime) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy suất chiếu.' });

  const now = new Date();
  const [seats, locks, surcharges] = await Promise.all([
    prisma.seat.findMany({ where: { roomId: showtime.roomId }, orderBy: [{ row: 'asc' }, { number: 'asc' }] }),
    prisma.seatLock.findMany({ where: { showtimeId }, select: { seatId: true, status: true, expiresAt: true } }),
    getSurcharges(),
  ]);

  const lockBySeat = new Map(locks.map((l) => [l.seatId, l]));
  const { seats: priced } = calcSeatPrices({ basePrice: showtime.basePrice, surcharges, seats });
  const priceBySeat = new Map(priced.map((p) => [p.id, p]));

  const statusOf = (seat) => {
    if (!seat.isActive) return 'UNAVAILABLE';
    const lock = lockBySeat.get(seat.id);
    if (!lock) return 'AVAILABLE';
    if (lock.status === 'SOLD') return 'SOLD';
    return lock.expiresAt && lock.expiresAt > now ? 'HELD' : 'AVAILABLE';
  };

  return {
    showtime: toDetail(showtime, now),
    rows: [...new Set(seats.map((s) => s.row))],
    seats: seats.map((s) => {
      const p = priceBySeat.get(s.id);
      return {
        id: s.id,
        row: s.row,
        number: s.number,
        label: `${s.row}${s.number}`,
        type: s.type,
        pairCode: s.pairCode,
        status: statusOf(s),
        price: p.pairPrice ?? p.price, // ghế đôi: hiển thị giá cả cặp (hợp đồng mục 3.3)
      };
    }),
  };
}
