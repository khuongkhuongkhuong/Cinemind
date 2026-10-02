import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { VN_OFFSET_MS } from '../lib/time.js';
import { calcSeatPrices, getBasePrice, getSurcharges } from './pricing.service.js';
import { buildMeta, toSkipTake } from '../utils/pagination.js';

const SALE_CUTOFF_MS = 15 * 60_000; // BR-04: ngừng bán online 15 phút trước giờ chiếu

/**
 * Suất còn mở bán không? (BR-04) — hàm thuần, booking.service dùng lại khi giữ ghế.
 * @param {{ status: string, startTime: Date }} showtime
 * @param {Date} [now]
 */
export const isOpenForSale = (showtime, now = new Date()) =>
  showtime.status === 'OPEN' && showtime.startTime.getTime() - now.getTime() > SALE_CUTOFF_MS;

/** "2026-10-02" (theo giờ VN) -> khoảng [00:00, 24:00) của ngày đó, tính bằng mốc UTC. */
export function vnDayRange(dateStr) {
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

// =============================================================================================
// QUẢN TRỊ SUẤT CHIẾU (ADMIN) — tạo / sửa / hủy suất, chặn trùng giờ trong cùng phòng.
// =============================================================================================

const CLEANUP_MS = 15 * 60_000; // thời gian dọn phòng cộng vào endTime (04-api-contract mục 2.7)

const adminSelect = {
  id: true, startTime: true, endTime: true, format: true, audio: true, basePrice: true, status: true,
  movie: { select: { id: true, title: true } },
  room: { select: { id: true, name: true, cinema: { select: { id: true, name: true } } } },
};

const toAdminShowtime = (s) => ({
  id: s.id, startTime: s.startTime, endTime: s.endTime, format: s.format, audio: s.audio,
  basePrice: s.basePrice, status: s.status, movie: s.movie,
  cinema: s.room.cinema, room: { id: s.room.id, name: s.room.name },
});

const computeEnd = (startTime, durationMin) => new Date(startTime.getTime() + durationMin * 60_000 + CLEANUP_MS);

/**
 * Có suất khác (chưa hủy) trong CÙNG PHÒNG bị chồng lấn thời gian không? Hai khoảng [s1,e1) và [s2,e2) chồng nhau
 * khi s1 < e2 VÀ e1 > s2. Hai suất nối đuôi nhau (suất sau bắt đầu đúng lúc suất trước kết thúc) KHÔNG tính là trùng.
 */
const findConflict = (tx, { roomId, startTime, endTime, excludeId }) =>
  tx.showtime.findFirst({
    where: {
      roomId, status: 'OPEN', startTime: { lt: endTime }, endTime: { gt: startTime },
      ...(excludeId && { id: { not: excludeId } }),
    },
    select: { id: true },
  });

/** Suất đã có người mua/giữ chưa? (đơn PAID, REFUND_PENDING, hoặc PENDING còn hạn). Có thì không được sửa/hủy. */
async function hasSales(db, showtimeId) {
  const n = await db.order.count({
    where: {
      showtimeId,
      OR: [{ status: { in: ['PAID', 'REFUND_PENDING'] } }, { status: 'PENDING', expiresAt: { gt: new Date() } }],
    },
  });
  return n > 0;
}

/**
 * Chạy `work(tx)` trong transaction ĐÃ KHÓA theo phòng. Hai admin cùng tạo suất chồng lấn trong một phòng: "kiểm tra có
 * trùng không rồi mới ghi" là check-then-insert nên bị race. Khóa tư vấn (advisory lock) theo roomId xếp họ thành hàng
 * (tự nhả khi transaction kết thúc): người sau sẽ thấy suất của người trước và nhận SHOWTIME_OVERLAP.
 */
const withRoomLock = (roomId, work) =>
  prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${roomId}))`;
    return work(tx);
  }, { maxWait: 10_000, timeout: 15_000 });

const overlapError = (conflict) => new AppError('SHOWTIME_OVERLAP', { details: { conflictShowtimeId: conflict.id } });
const fieldError = (field, message) => new AppError('VALIDATION_ERROR', { details: { fields: { [field]: message } } });

/**
 * Danh sách suất chiếu cho trang quản trị.
 * @param {{ cinemaId?: string, roomId?: string, date?: string, page: number, pageSize: number }} params date: YYYY-MM-DD (giờ VN)
 */
export async function listAdminShowtimes({ cinemaId, roomId, date, page, pageSize }) {
  const where = {
    ...(roomId && { roomId }),
    ...(cinemaId && { room: { cinemaId } }),
    ...(date && { startTime: { gte: vnDayRange(date).from, lt: vnDayRange(date).to } }),
  };
  const [total, rows] = await Promise.all([
    prisma.showtime.count({ where }),
    prisma.showtime.findMany({ where, orderBy: { startTime: 'asc' }, ...toSkipTake({ page, pageSize }), select: adminSelect }),
  ]);
  return { items: rows.map(toAdminShowtime), meta: buildMeta({ page, pageSize }, total) };
}

/**
 * Tạo suất chiếu. Server tự tính `endTime` (thời lượng phim + 15 phút dọn phòng) và `basePrice` từ bảng giá nếu không gửi.
 * @param {{ movieId: string, roomId: string, startTime: Date, format: string, audio: string, basePrice?: number }} params
 * @returns {Promise<object>} suất vừa tạo
 * @throws {AppError} NOT_FOUND | VALIDATION_ERROR | SHOWTIME_OVERLAP
 */
export async function createShowtime({ movieId, roomId, startTime, format, audio, basePrice }) {
  if (startTime.getTime() <= Date.now()) throw fieldError('startTime', 'Giờ chiếu phải ở tương lai.');
  const [movie, room] = await Promise.all([
    prisma.movie.findUnique({ where: { id: movieId } }),
    prisma.room.findUnique({ where: { id: roomId } }),
  ]);
  if (!movie) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy phim.' });
  if (!room || !room.isActive) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy phòng chiếu.' });

  const endTime = computeEnd(startTime, movie.durationMin);
  const price = basePrice ?? (await getBasePrice({ format, startTime })).basePrice;

  const created = await withRoomLock(roomId, async (tx) => {
    const conflict = await findConflict(tx, { roomId, startTime, endTime });
    if (conflict) throw overlapError(conflict);
    return tx.showtime.create({
      data: { movieId, roomId, startTime, endTime, format, audio, basePrice: price },
      select: adminSelect,
    });
  });
  return toAdminShowtime(created);
}

/**
 * Sửa suất chiếu. Suất đã có người mua/giữ thì không sửa được (RESOURCE_IN_USE).
 * Đổi giờ hoặc định dạng mà không gửi `basePrice` thì giá gốc được tính lại từ bảng giá.
 * @param {{ showtimeId: string, movieId?: string, roomId?: string, startTime?: Date, format?: string, audio?: string, basePrice?: number }} params
 * @throws {AppError} NOT_FOUND | VALIDATION_ERROR | RESOURCE_IN_USE | SHOWTIME_OVERLAP
 */
export async function updateShowtime({ showtimeId, ...changes }) {
  const current = await prisma.showtime.findUnique({ where: { id: showtimeId }, include: { movie: true } });
  if (!current) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy suất chiếu.' });
  if (current.status !== 'OPEN') throw new AppError('RESOURCE_IN_USE', { message: 'Suất đã hủy không sửa được.' });

  const next = {
    movieId: changes.movieId ?? current.movieId,
    roomId: changes.roomId ?? current.roomId,
    startTime: changes.startTime ?? current.startTime,
    format: changes.format ?? current.format,
    audio: changes.audio ?? current.audio,
  };
  if (changes.startTime && next.startTime.getTime() <= Date.now()) throw fieldError('startTime', 'Giờ chiếu phải ở tương lai.');
  const movie = next.movieId === current.movieId ? current.movie : await prisma.movie.findUnique({ where: { id: next.movieId } });
  if (!movie) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy phim.' });
  if (next.roomId !== current.roomId) {
    const room = await prisma.room.findUnique({ where: { id: next.roomId } });
    if (!room || !room.isActive) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy phòng chiếu.' });
  }
  const endTime = computeEnd(next.startTime, movie.durationMin);
  const repriced = changes.startTime || changes.format; // đổi giờ hoặc định dạng => giá gốc có thể đổi theo
  const basePrice = changes.basePrice
    ?? (repriced ? (await getBasePrice({ format: next.format, startTime: next.startTime })).basePrice : current.basePrice);

  const updated = await withRoomLock(next.roomId, async (tx) => {
    if (await hasSales(tx, showtimeId)) {
      throw new AppError('RESOURCE_IN_USE', { message: 'Suất đã có người đặt vé nên không thể sửa.' });
    }
    const conflict = await findConflict(tx, { roomId: next.roomId, startTime: next.startTime, endTime, excludeId: showtimeId });
    if (conflict) throw overlapError(conflict);
    return tx.showtime.update({ where: { id: showtimeId }, data: { ...next, endTime, basePrice }, select: adminSelect });
  });
  return toAdminShowtime(updated);
}

/**
 * Hủy suất chiếu (không xóa, để giữ lịch sử). Suất đã có người mua/giữ thì phải xử lý đơn trước (RESOURCE_IN_USE).
 * Gọi lại trên suất đã hủy: trả nguyên suất đó (idempotent).
 * @param {{ showtimeId: string }} params
 * @throws {AppError} NOT_FOUND | RESOURCE_IN_USE
 */
export async function cancelShowtime({ showtimeId }) {
  const current = await prisma.showtime.findUnique({ where: { id: showtimeId }, select: { roomId: true, status: true } });
  if (!current) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy suất chiếu.' });
  const updated = await withRoomLock(current.roomId, async (tx) => {
    if (current.status === 'CANCELLED') return tx.showtime.findUnique({ where: { id: showtimeId }, select: adminSelect });
    if (await hasSales(tx, showtimeId)) {
      throw new AppError('RESOURCE_IN_USE', { message: 'Suất đã có người đặt vé; hãy xử lý các đơn trước khi hủy.' });
    }
    return tx.showtime.update({ where: { id: showtimeId }, data: { status: 'CANCELLED' }, select: adminSelect });
  });
  return toAdminShowtime(updated);
}

/**
 * Lịch chiếu của MỘT RẠP trong một ngày, nhóm theo phim -> (định dạng, phụ đề/lồng tiếng) (docs 3.2b).
 * Chỉ suất OPEN; rạp đã tắt coi như không tồn tại với khách.
 * @param {{ cinemaId: string, date: string }} params date dạng YYYY-MM-DD (giờ VN)
 * @returns {Promise<{ date: string, cinema: object, movies: object[] }>}
 * @throws {AppError} NOT_FOUND
 */
export async function listShowtimesByCinema({ cinemaId, date }) {
  const cinema = await prisma.cinema.findFirst({ where: { id: cinemaId, isActive: true }, select: { id: true, name: true, address: true } });
  if (!cinema) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy rạp.' });

  const { from, to } = vnDayRange(date);
  const now = new Date();
  const rows = await prisma.showtime.findMany({
    where: { status: 'OPEN', startTime: { gte: from, lt: to }, room: { cinemaId } },
    orderBy: { startTime: 'asc' },
    select: {
      id: true, startTime: true, format: true, audio: true, status: true,
      movie: { select: { id: true, title: true, slug: true, ageRating: true, posterUrl: true, durationMin: true } },
    },
  });

  const byMovie = new Map();
  for (const s of rows) {
    if (!byMovie.has(s.movie.id)) byMovie.set(s.movie.id, { movie: s.movie, groups: new Map() });
    const { groups } = byMovie.get(s.movie.id);
    const key = `${s.format}|${s.audio}`;
    if (!groups.has(key)) groups.set(key, { format: s.format, audio: s.audio, showtimes: [] });
    groups.get(key).showtimes.push({ id: s.id, startTime: s.startTime, isOpenForSale: isOpenForSale(s, now) });
  }
  return {
    date,
    cinema,
    movies: [...byMovie.values()].map(({ movie, groups }) => ({ movie, groups: [...groups.values()] })),
  };
}
