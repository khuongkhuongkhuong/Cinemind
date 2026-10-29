import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { VN_OFFSET_MS, toVnClock } from '../lib/time.js';
import { calcSeatPrices, getBasePrice, getSurcharges } from './pricing.service.js';
import { buildMeta, toSkipTake } from '../utils/pagination.js';
import { findCitiesByName } from './catalog.service.js';

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

// =============================================================================================
// DÀNH CHO TRỢ LÝ AI (docs/07 mục 2, 10): tìm suất chiếu dạng danh sách phẳng + gợi ý ghế liền nhau.
// =============================================================================================

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/**
 * Tìm các suất chiếu CÒN MỞ BÁN trong một ngày, kết quả phẳng (dễ đọc cho LLM), kèm số ghế còn trống.
 * @param {{ date: string, movieId?: string, cinemaId?: string, cityId?: string, cityName?: string,
 *   timeFrom?: string, timeTo?: string, format?: 'F2D'|'F3D'|'IMAX', limit?: number }} params
 *   `date`: YYYY-MM-DD (giờ VN, bắt buộc) · `timeFrom`/`timeTo`: HH:mm giờ VN · `cityName`: tên thành phố, không dấu cũng được.
 * @returns {Promise<Array<{ showtimeId: string, movieId: string, movieTitle: string, cinemaId: string, cinemaName: string,
 *   startTime: Date, startTimeLocal: string, dateLocal: string, format: string, audio: string, basePrice: number, availableSeatCount: number }>>}
 *   Sắp theo giờ chiếu; suất đã đóng bán (BR-04) và suất đã hủy không có trong kết quả.
 * @throws {AppError} VALIDATION_ERROR
 */
export async function findShowtimes({ date, movieId, cinemaId, cityId, cityName, timeFrom, timeTo, format, limit = 20 } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || Number.isNaN(Date.parse(date))) throw fieldError('date', 'Ngày phải có dạng YYYY-MM-DD.');
  if (timeFrom && !HHMM.test(timeFrom)) throw fieldError('timeFrom', 'Giờ phải có dạng HH:mm.');
  if (timeTo && !HHMM.test(timeTo)) throw fieldError('timeTo', 'Giờ phải có dạng HH:mm.');

  let cityIds = cityId ? [cityId] : undefined;
  if (cityName) {
    cityIds = (await findCitiesByName(cityName)).map((c) => c.id);
    if (cityIds.length === 0) return [];
  }

  const { from, to } = vnDayRange(date);
  const now = new Date();
  const rows = await prisma.showtime.findMany({
    where: {
      status: 'OPEN',
      startTime: { gte: from, lt: to },
      ...(movieId && { movieId }),
      ...(format && { format }),
      room: { isActive: true, cinema: { isActive: true, ...(cinemaId && { id: cinemaId }), ...(cityIds && { cityId: { in: cityIds } }) } },
    },
    orderBy: { startTime: 'asc' },
    select: {
      id: true, startTime: true, format: true, audio: true, basePrice: true, status: true, roomId: true,
      movie: { select: { id: true, title: true } },
      room: { select: { cinema: { select: { id: true, name: true } } } },
    },
  });

  const open = rows.filter((s) => {
    if (!isOpenForSale(s, now)) return false;
    const local = toVnClock(s.startTime);
    const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
    return (!timeFrom || minutes >= minutesOf(timeFrom)) && (!timeTo || minutes <= minutesOf(timeTo));
  }).slice(0, Math.min(Math.max(1, limit), 50));
  if (open.length === 0) return [];

  // Số ghế còn trống = ghế dùng được của phòng − ghế đã bán hoặc đang được giữ còn hạn (giữ quá hạn coi như trống: dọn lười).
  const [seatCounts, lockCounts] = await Promise.all([
    prisma.seat.groupBy({ by: ['roomId'], where: { roomId: { in: [...new Set(open.map((s) => s.roomId))] }, isActive: true }, _count: { _all: true } }),
    prisma.seatLock.groupBy({
      by: ['showtimeId'],
      where: { showtimeId: { in: open.map((s) => s.id) }, OR: [{ status: 'SOLD' }, { expiresAt: { gt: now } }] },
      _count: { _all: true },
    }),
  ]);
  const seatsOfRoom = new Map(seatCounts.map((c) => [c.roomId, c._count._all]));
  const takenOf = new Map(lockCounts.map((c) => [c.showtimeId, c._count._all]));

  return open.map((s) => {
    const local = toVnClock(s.startTime).toISOString();
    return {
      showtimeId: s.id,
      movieId: s.movie.id,
      movieTitle: s.movie.title,
      cinemaId: s.room.cinema.id,
      cinemaName: s.room.cinema.name,
      startTime: s.startTime,
      startTimeLocal: local.slice(11, 16),
      dateLocal: local.slice(0, 10),
      format: s.format,
      audio: s.audio,
      basePrice: s.basePrice,
      availableSeatCount: Math.max(0, (seatsOfRoom.get(s.roomId) ?? 0) - (takenOf.get(s.id) ?? 0)),
    };
  });
}

/**
 * Gợi ý tối đa `limit` (mặc định 3) phương án ghế LIỀN NHAU, cùng hàng, cùng loại, đang trống.
 * - Ghế đôi (`seatType = 'COUPLE'`): `quantity` phải chẵn; các CẶP đứng liền nhau. Không chọn ghế đôi nếu không yêu cầu.
 * - `preference`: `CENTER` (giữa phòng, hơi lùi về sau — mặc định) · `BACK` (hàng sau) · `AISLE` (sát lối đi, đầu / cuối hàng).
 * - `totalPrice` do server tính bằng ĐÚNG hàm tính giá của đặt vé (BR-11, BR-13) nên khớp tổng tiền đơn sau khi giữ ghế.
 * Chỉ là GỢI Ý: ghế vẫn có thể bị người khác lấy trước khi giữ; `holdSeats` mới là trọng tài.
 * @param {{ showtimeId: string, quantity: number, preference?: 'CENTER'|'BACK'|'AISLE', seatType?: 'STANDARD'|'VIP'|'COUPLE', limit?: number }} params
 * @returns {Promise<Array<{ seatIds: string[], labels: string[], row: string, seatType: string, totalPrice: number }>>} [] nếu không có phương án nào
 * @throws {AppError} NOT_FOUND | SHOWTIME_CLOSED | SEAT_LIMIT_EXCEEDED | VALIDATION_ERROR
 */
export async function suggestSeats({ showtimeId, quantity, preference = 'CENTER', seatType, limit = 3 }) {
  if (!Number.isInteger(quantity) || quantity < 1) throw fieldError('quantity', 'Số ghế phải là số nguyên từ 1.');
  if (quantity > 8) throw new AppError('SEAT_LIMIT_EXCEEDED'); // BR-02
  if (!['CENTER', 'BACK', 'AISLE'].includes(preference)) throw fieldError('preference', 'preference phải là CENTER, BACK hoặc AISLE.');
  if (seatType && !['STANDARD', 'VIP', 'COUPLE'].includes(seatType)) throw fieldError('seatType', 'Loại ghế không hợp lệ.');
  const wantCouple = seatType === 'COUPLE';
  if (wantCouple && quantity % 2 !== 0) throw fieldError('quantity', 'Ghế đôi phải chọn theo cặp (số ghế chẵn).'); // BR-05

  const map = await getSeatMap({ showtimeId });
  if (!map.showtime.isOpenForSale) throw new AppError('SHOWTIME_CLOSED'); // BR-04

  // Mỗi "đơn vị" là một ghế lẻ, hoặc một CẶP ghế đôi (hai ghế cùng pairCode liền nhau, đều trống).
  const rowsOf = new Map();
  for (const s of map.seats) {
    if (s.status !== 'AVAILABLE') continue;
    if (wantCouple ? s.type !== 'COUPLE' : s.type === 'COUPLE' || (seatType && s.type !== seatType)) continue;
    if (!rowsOf.has(s.row)) rowsOf.set(s.row, []);
    rowsOf.get(s.row).push(s);
  }
  const units = (seats) => {
    const sorted = [...seats].sort((a, b) => a.number - b.number);
    if (!wantCouple) return sorted.map((s) => ({ seats: [s], number: s.number, type: s.type }));
    const pairs = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].pairCode && sorted[i].pairCode === sorted[i + 1].pairCode && sorted[i + 1].number === sorted[i].number + 1) {
        pairs.push({ seats: [sorted[i], sorted[i + 1]], number: sorted[i].number, type: 'COUPLE' });
        i++;
      }
    }
    return pairs;
  };

  const allRows = map.rows;
  const maxNumber = Math.max(...map.seats.map((s) => s.number));
  const need = wantCouple ? quantity / 2 : quantity;
  const candidates = [];
  for (const row of allRows) {
    const list = units(rowsOf.get(row) ?? []);
    for (let i = 0; i + need <= list.length; i++) {
      const window = list.slice(i, i + need);
      const contiguous = window.every((u, k) => k === 0 || u.number === window[k - 1].number + (wantCouple ? 2 : 1));
      const sameType = window.every((u) => u.type === window[0].type);
      if (!contiguous || !sameType) continue;
      const seats = window.flatMap((u) => u.seats);
      const first = seats[0].number; const last = seats[seats.length - 1].number;
      const rowIndex = allRows.indexOf(row);
      const colDist = Math.abs((first + last) / 2 - (maxNumber + 1) / 2);
      const idealRow = 0.6 * (allRows.length - 1);
      const score = preference === 'BACK' ? (allRows.length - 1 - rowIndex) * 3 + colDist
        : preference === 'AISLE' ? (first === 1 || last === maxNumber ? 0 : 1 + Math.min(first - 1, maxNumber - last)) * 3 + Math.abs(rowIndex - idealRow)
          : colDist + 1.5 * Math.abs(rowIndex - idealRow);
      candidates.push({ row, seats, score });
    }
  }
  candidates.sort((a, b) => a.score - b.score || a.row.localeCompare(b.row));

  // Ưu tiên các hàng KHÁC NHAU để khách có lựa chọn thật sự; còn thiếu thì lấy thêm phương án cùng hàng.
  const picked = [];
  const usedRows = new Set();
  const max = Math.min(Math.max(1, limit), 10); // trần 10 phương án để không tràn ngữ cảnh của LLM
  for (const c of candidates) if (!usedRows.has(c.row) && picked.length < max) { picked.push(c); usedRows.add(c.row); }
  for (const c of candidates) if (picked.length < max && !picked.includes(c)) picked.push(c);

  const [{ basePrice }, surcharges] = await Promise.all([
    prisma.showtime.findUnique({ where: { id: showtimeId }, select: { basePrice: true } }),
    getSurcharges(),
  ]);
  return picked.map((c) => ({
    seatIds: c.seats.map((s) => s.id),
    labels: c.seats.map((s) => s.label),
    row: c.row,
    seatType: c.seats[0].type,
    totalPrice: calcSeatPrices({ basePrice, surcharges, seats: c.seats.map((s) => ({ id: s.id, type: s.type, pairCode: s.pairCode })) }).total,
  }));
}
