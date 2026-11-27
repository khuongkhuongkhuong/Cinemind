import { prisma, runInTransaction } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { VN_OFFSET_MS, toVnClock } from '../lib/time.js';
import { getBasePrice } from './pricing.service.js';
import { buildMeta, toSkipTake } from '../utils/pagination.js';
import { findCitiesByName, getActiveCinemaSummary } from './catalog.service.js';
import * as movieService from './movie.service.js';
import * as roomService from './room.service.js';
import * as ticketService from './ticket.service.js';
import * as seatService from './seat.service.js';

// ---- Hằng dùng cho truy vấn (Showtime) ----

/** Phim + phòng + rạp của suất (cho ShowtimeDetail). */
export const SHOWTIME_INCLUDE = {
  movie: { select: { id: true, title: true, ageRating: true, posterUrl: true } },
  room: { select: { id: true, name: true, isActive: true, cinema: { select: { id: true, name: true, isActive: true } } } },
};

/** Các trường suất cho trang quản trị. */
export const ADMIN_SELECT = {
  id: true, startTime: true, endTime: true, format: true, audio: true, basePrice: true, status: true,
  movie: { select: { id: true, title: true } },
  room: { select: { id: true, name: true, cinema: { select: { id: true, name: true } } } },
};

const SALE_CUTOFF_MS = 15 * 60_000; // BR-04: ngừng bán online 15 phút trước giờ chiếu
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/**
 * Suất còn mở bán không? (BR-04) — hàm thuần, order.service dùng lại khi giữ ghế.
 * Nếu dòng suất có kèm phòng / rạp (SHOWTIME_INCLUDE) thì phòng ngưng hoặc rạp tắt cũng là đóng bán (v1.29).
 * @param {{ status: string, startTime: Date, room?: { isActive?: boolean, cinema?: { isActive?: boolean } } }} showtime
 * @param {Date} [now]
 */
export const isOpenForSale = (showtime, now = new Date()) =>
  showtime.status === 'OPEN' && showtime.startTime.getTime() - now.getTime() > SALE_CUTOFF_MS
  && showtime.room?.isActive !== false && showtime.room?.cinema?.isActive !== false;

/** "2026-10-02" (theo giờ VN) -> khoảng [00:00, 24:00) của ngày đó, tính bằng mốc UTC. */
export function vnDayRange(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, d) - VN_OFFSET_MS);
  return { from, to: new Date(from.getTime() + 24 * 3600_000) };
}

/** Dòng Prisma -> ShowtimeDetail (04-api-contract mục 3.3). */
export const toDetail = (s, now) => ({
  id: s.id,
  startTime: s.startTime,
  endTime: s.endTime,
  format: s.format,
  audio: s.audio,
  isOpenForSale: isOpenForSale(s, now),
  movie: s.movie,
  cinema: { id: s.room.cinema.id, name: s.room.cinema.name },
  room: { id: s.room.id, name: s.room.name },
});

/**
 * Lịch chiếu của một phim trong một ngày, nhóm theo rạp -> (định dạng, phụ đề/lồng tiếng).
 * @param {{ movieId: string, date: string, cityId: string }} params date dạng YYYY-MM-DD (giờ VN)
 * @returns {Promise<{ date: string, cinemas: object[] }>}
 * @throws {AppError} NOT_FOUND
 */
export async function listShowtimesByMovie({ movieId, date, cityId }) {
  if (!(await movieService.movieExists(movieId))) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy phim.' });

  const { from, to } = vnDayRange(date);
  const now = new Date();
  const rows = await listOpenShowtimesOfMovie({ movieId, from, to, cityId });

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
  return toDetail(await loadShowtime({ showtimeId, withDetail: true }), new Date());
}

/**
 * Nạp một suất chiếu từ CSDL; dùng chung cho các service khác (seat, order) để cùng một thông báo NOT_FOUND.
 * @param {{ showtimeId: string, withDetail?: boolean }} params `withDetail`: kèm phim / phòng / rạp (cho `toDetail`)
 * @returns {Promise<object>} dòng Showtime (kèm quan hệ nếu `withDetail`)
 * @throws {AppError} NOT_FOUND
 */
export async function loadShowtime({ showtimeId, withDetail = false }) {
  const row = await (withDetail ? getShowtimeDetail(showtimeId) : getShowtimeById(showtimeId));
  if (!row) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy suất chiếu.' });
  return row;
}

/**
 * Suất chiếu CÒN MỞ BÁN (BR-04) — order.service gọi khi giữ ghế.
 * @param {{ showtimeId: string, now?: Date }} params
 * @returns {Promise<object>} dòng Showtime
 * @throws {AppError} NOT_FOUND | SHOWTIME_CLOSED
 */
export async function getOpenShowtime({ showtimeId, now = new Date() }) {
  const showtime = await loadShowtime({ showtimeId, withDetail: true }); // kèm phòng / rạp để chặn phòng ngưng, rạp tắt
  if (!isOpenForSale(showtime, now)) throw new AppError('SHOWTIME_CLOSED');
  return showtime;
}

// =============================================================================================
// QUẢN TRỊ SUẤT CHIẾU (ADMIN) — tạo / sửa / hủy suất, chặn trùng giờ trong cùng phòng.
// =============================================================================================

const CLEANUP_MS = 15 * 60_000; // thời gian dọn phòng cộng vào endTime (04-api-contract mục 2.7)

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
const findConflict = (tx, { roomId, startTime, endTime, excludeId }) => findOverlapInRoom({ roomId, startTime, endTime, excludeId }, tx);

/** Suất đã có người mua/giữ chưa? (vé SOLD, HELD còn hạn, hoặc đơn REFUND_PENDING). Có thì không được sửa/hủy. */
const hasSales = (db, showtimeId) => ticketService.hasActiveSales({ showtimeId }, db);

/**
 * Chạy `work(tx)` trong transaction ĐÃ KHÓA theo phòng. Hai admin cùng tạo suất chồng lấn trong một phòng: "kiểm tra có
 * trùng không rồi mới ghi" là check-then-insert nên bị race. Khóa tư vấn (advisory lock) theo roomId xếp họ thành hàng
 * (tự nhả khi transaction kết thúc): người sau sẽ thấy suất của người trước và nhận SHOWTIME_OVERLAP.
 */
export const withRoomLock = (roomId, work) =>
  runInTransaction(async (tx) => {
    await lockRoom(tx, roomId);
    return work(tx);
  }, { maxWait: 10_000, timeout: 15_000 });

const overlapError = (conflict) => new AppError('SHOWTIME_OVERLAP', { details: { conflictShowtimeId: conflict.id } });
const fieldError = (field, message) => new AppError('VALIDATION_ERROR', { details: { fields: { [field]: message } } });

/**
 * Danh sách suất chiếu cho trang quản trị.
 * @param {{ cinemaId?: string, roomId?: string, date?: string, page: number, pageSize: number }} params date: YYYY-MM-DD (giờ VN)
 */
export async function listAdminShowtimes({ cinemaId, roomId, date, page, pageSize }) {
  const range = date ? vnDayRange(date) : {};
  const filter = { roomId, cinemaId, from: range.from, to: range.to };
  const [total, rows] = await Promise.all([
    countAdminShowtimes(filter),
    findAdminShowtimes(filter, toSkipTake({ page, pageSize })),
  ]);
  const booked = rows.length
    ? await ticketService.countTakenSeatsByShowtime({ showtimeIds: rows.map((s) => s.id), now: new Date() })
    : new Map();
  return { items: rows.map((s) => ({ ...toAdminShowtime(s), bookedSeats: booked.get(s.id) ?? 0 })), meta: buildMeta({ page, pageSize }, total) };
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
    movieService.getMovieById(movieId),
    roomService.getRoomById(roomId),
  ]);
  if (!movie) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy phim.' });
  if (!room || !room.isActive) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy phòng chiếu.' });

  const endTime = computeEnd(startTime, movie.durationMin);
  const price = basePrice ?? (await getBasePrice({ format, startTime })).basePrice;

  const created = await withRoomLock(roomId, async (tx) => {
    const conflict = await findConflict(tx, { roomId, startTime, endTime });
    if (conflict) throw overlapError(conflict);
    return insertShowtime({ movieId, roomId, startTime, endTime, format, audio, basePrice: price }, tx);
  });
  return toAdminShowtime(created);
}

export const BULK_LIMIT = 200; // số suất tối đa của một lần tạo hàng loạt

const overlaps = (a, b) => a.startTime < b.endTime && a.endTime > b.startTime; // cùng quy tắc với findOverlapInRoom

/** Xét từng suất theo thứ tự giờ: đã qua / trùng suất đang có / trùng suất đứng trước trong lô / tạo được. */
function judgeCandidates(candidates, existing, now) {
  const accepted = [];
  return candidates.map((c) => {
    if (c.startTime <= now) return { ...c, result: 'PAST', conflict: null };
    const clash = existing.find((e) => overlaps(c, e));
    if (clash) {
      const conflict = { showtimeId: clash.id, movieTitle: clash.movie.title, startTime: clash.startTime, endTime: clash.endTime };
      return { ...c, result: 'OVERLAP', conflict };
    }
    const inBatch = accepted.find((a) => overlaps(c, a));
    if (inBatch) {
      return { ...c, result: 'BATCH_OVERLAP', conflict: { showtimeId: null, movieTitle: null, startTime: inBatch.startTime, endTime: inBatch.endTime } };
    }
    accepted.push(c);
    return { ...c, result: 'OK', conflict: null };
  });
}

/**
 * Tạo nhiều suất một lần cho MỘT phim trong MỘT phòng: mỗi (ngày × giờ) một suất, giờ Việt Nam.
 * Suất lỗi bị bỏ qua và nêu lý do; `dryRun` chỉ xem trước, không ghi gì.
 * @param {{ movieId: string, roomId: string, dates: string[], times: string[], format: string, audio: string, basePrice?: number, dryRun?: boolean }} params
 *   `dates`: YYYY-MM-DD · `times`: HH:mm
 * @returns {Promise<{ dryRun: boolean, okCount: number, skippedCount: number, items: Array<{ date: string, time: string, startTime: Date,
 *   endTime: Date, basePrice: number, result: 'OK'|'PAST'|'OVERLAP'|'BATCH_OVERLAP', conflict: object|null }> }>}
 * @throws {AppError} NOT_FOUND | VALIDATION_ERROR
 */
export async function createShowtimesBulk({ movieId, roomId, dates, times, format, audio, basePrice, dryRun = false }) {
  const days = [...new Set(dates)].sort();
  const hours = [...new Set(times)].sort();
  if (days.length * hours.length > BULK_LIMIT) throw fieldError('dates', `Mỗi lần tạo tối đa ${BULK_LIMIT} suất.`);
  const [movie, room] = await Promise.all([movieService.getMovieById(movieId), roomService.getRoomById(roomId)]);
  if (!movie || movie.status === 'ENDED') throw new AppError('NOT_FOUND', { message: 'Không tìm thấy phim đang hoặc sắp chiếu.' });
  if (!room || !room.isActive) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy phòng chiếu.' });

  const candidates = [];
  for (const date of days) {
    const { from } = vnDayRange(date); // 00:00 giờ VN
    // Giá theo bảng giá chỉ phụ thuộc ngày (thường / cuối tuần): tra một lần cho mỗi ngày.
    const price = basePrice ?? (await getBasePrice({ format, startTime: new Date(from.getTime() + 12 * 3600_000) })).basePrice;
    for (const time of hours) {
      const startTime = new Date(from.getTime() + minutesOf(time) * 60_000);
      candidates.push({ date, time, startTime, endTime: computeEnd(startTime, movie.durationMin), basePrice: price });
    }
  }
  const span = { roomId, from: candidates[0].startTime, to: candidates.at(-1).endTime };
  const summarize = (items) => {
    const okCount = items.filter((i) => i.result === 'OK').length;
    return { dryRun, okCount, skippedCount: items.length - okCount, items };
  };

  if (dryRun) return summarize(judgeCandidates(candidates, await findOpenShowtimesInRoom(span), new Date()));

  return withRoomLock(roomId, async (tx) => {
    // Xét lại SAU KHI khóa phòng: từ lúc xem trước đến giờ người khác có thể đã thêm suất.
    const items = judgeCandidates(candidates, await findOpenShowtimesInRoom(span, tx), new Date());
    const rows = items.filter((i) => i.result === 'OK')
      .map((i) => ({ movieId, roomId, startTime: i.startTime, endTime: i.endTime, format, audio, basePrice: i.basePrice }));
    if (rows.length) await insertShowtimes(rows, tx);
    return summarize(items);
  });
}

/**
 * Sửa suất chiếu. Suất đã có người mua/giữ thì không sửa được (RESOURCE_IN_USE).
 * Đổi giờ hoặc định dạng mà không gửi `basePrice` thì giá gốc được tính lại từ bảng giá.
 * @param {{ showtimeId: string, movieId?: string, roomId?: string, startTime?: Date, format?: string, audio?: string, basePrice?: number }} params
 * @throws {AppError} NOT_FOUND | VALIDATION_ERROR | RESOURCE_IN_USE | SHOWTIME_OVERLAP
 */
export async function updateShowtime({ showtimeId, ...changes }) {
  const current = await getShowtimeWithMovie(showtimeId);
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
  const movie = next.movieId === current.movieId ? current.movie : await movieService.getMovieById(next.movieId);
  if (!movie) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy phim.' });
  if (next.roomId !== current.roomId) {
    const room = await roomService.getRoomById(next.roomId);
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
    return updateShowtimeById(showtimeId, { ...next, endTime, basePrice }, tx);
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
  const current = await getShowtimeRoomAndStatus(showtimeId);
  if (!current) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy suất chiếu.' });
  const updated = await withRoomLock(current.roomId, async (tx) => {
    if (current.status === 'CANCELLED') return getAdminShowtime(showtimeId, tx);
    if (await hasSales(tx, showtimeId)) {
      throw new AppError('RESOURCE_IN_USE', { message: 'Suất đã có người đặt vé; hãy xử lý các đơn trước khi hủy.' });
    }
    return updateShowtimeById(showtimeId, { status: 'CANCELLED' }, tx);
  });
  return toAdminShowtime(updated);
}

/**
 * Phòng đã từng có suất chiếu chưa (kể cả đã qua / đã hủy)? room.service gọi trước khi xóa phòng.
 * @param {{ roomId: string }} params
 * @param {object} [db]
 * @returns {Promise<boolean>}
 */
export async function roomHasShowtimes({ roomId }, db) {
  return (await countAdminShowtimes({ roomId }, db)) > 0;
}

/**
 * Phòng còn suất CHƯA chiếu, còn mở, đã có người mua / giữ vé không? room.service gọi trước khi ngưng phòng.
 * @param {{ roomId: string, now?: Date }} params
 * @param {object} [db]
 * @returns {Promise<boolean>}
 */
export async function roomHasUpcomingSales({ roomId, now = new Date() }, db) {
  const showtimeIds = (await listUpcomingShowtimeIds({ roomId, now }, db)).map((s) => s.id);
  return showtimeIds.length > 0 && ticketService.hasActiveSalesInShowtimes({ showtimeIds, now }, db);
}

/**
 * Lịch chiếu của MỘT RẠP trong một ngày, nhóm theo phim -> (định dạng, phụ đề/lồng tiếng) (docs 3.2b).
 * Chỉ suất OPEN; rạp đã tắt coi như không tồn tại với khách.
 * @param {{ cinemaId: string, date: string }} params date dạng YYYY-MM-DD (giờ VN)
 * @returns {Promise<{ date: string, cinema: object, movies: object[] }>}
 * @throws {AppError} NOT_FOUND
 */
export async function listShowtimesByCinema({ cinemaId, date }) {
  const cinema = await getActiveCinemaSummary(cinemaId);
  if (!cinema) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy rạp.' });

  const { from, to } = vnDayRange(date);
  const now = new Date();
  const rows = await listOpenShowtimesOfCinema({ cinemaId, from, to });

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
// DÀNH CHO TRỢ LÝ AI (docs/07 mục 2, 10): tìm suất chiếu dạng danh sách phẳng. (Gợi ý ghế / xem trước giữ ghế nay ở seat.service.)
// =============================================================================================

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
  const rows = await searchOpenShowtimes({ from, to, movieId, format, cinemaId, cityIds });

  const open = rows.filter((s) => {
    if (!isOpenForSale(s, now)) return false;
    const local = toVnClock(s.startTime);
    const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
    return (!timeFrom || minutes >= minutesOf(timeFrom)) && (!timeTo || minutes <= minutesOf(timeTo));
  }).slice(0, Math.min(Math.max(1, limit), 50));
  if (open.length === 0) return [];

  // Số ghế còn trống = ghế dùng được của phòng − ghế đã bán hoặc đang được giữ còn hạn (giữ quá hạn coi như trống: dọn lười).
  const [seatsOfRoom, takenOf] = await Promise.all([
    seatService.countActiveSeatsByRoom([...new Set(open.map((s) => s.roomId))]),
    ticketService.countTakenSeatsByShowtime({ showtimeIds: open.map((s) => s.id), now }),
  ]);

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

// =============================================================================================
// TRUY VẤN NỘI BỘ (@internal) — bảng Showtime. Mỗi hàm MỘT thao tác đọc / ghi; chỉ file này gọi chúng (docs/04 v1.26).
// Tham số cuối `db = prisma`: truyền `tx` khi chạy trong transaction. Lỗi CSDL (vd P2002) đi xuyên ra cho hàm nghiệp vụ xử lý.
// =============================================================================================

/**
 * @returns {Promise<object|null>} suất kèm phim + phòng + rạp
 * @internal
 */
export const getShowtimeDetail = (showtimeId, db = prisma) => db.showtime.findUnique({ where: { id: showtimeId }, include: SHOWTIME_INCLUDE });

/**
 * Suất kèm bản ghi phim (cho sửa suất).
 * @internal
 */
export const getShowtimeWithMovie = (showtimeId, db = prisma) => db.showtime.findUnique({ where: { id: showtimeId }, include: { movie: true } });

/**
 * Chỉ phòng + trạng thái (cho hủy suất). @returns {Promise<{ roomId: string, status: string }|null>}
 * @internal
 */
export const getShowtimeRoomAndStatus = (showtimeId, db = prisma) =>
  db.showtime.findUnique({ where: { id: showtimeId }, select: { roomId: true, status: true } });

/**
 * Suất theo `ADMIN_SELECT`.
 * @internal
 */
export const getAdminShowtime = (showtimeId, db = prisma) => db.showtime.findUnique({ where: { id: showtimeId }, select: ADMIN_SELECT });

/**
 * Các suất OPEN của MỘT PHIM trong khoảng [from, to) ở các rạp đang hoạt động của một thành phố, sắp theo giờ.
 * @internal
 */
export const listOpenShowtimesOfMovie = ({ movieId, from, to, cityId }, db = prisma) =>
  db.showtime.findMany({
    where: {
      movieId,
      status: 'OPEN',
      startTime: { gte: from, lt: to },
      room: { isActive: true, cinema: { cityId, isActive: true } },
    },
    orderBy: { startTime: 'asc' },
    select: {
      id: true, startTime: true, format: true, audio: true, status: true,
      room: { select: { cinema: { select: { id: true, name: true, address: true } } } },
    },
  });

/**
 * Các suất OPEN của MỘT RẠP trong khoảng [from, to), kèm phim, sắp theo giờ.
 * @internal
 */
export const listOpenShowtimesOfCinema = ({ cinemaId, from, to }, db = prisma) =>
  db.showtime.findMany({
    where: { status: 'OPEN', startTime: { gte: from, lt: to }, room: { cinemaId, isActive: true } },
    orderBy: { startTime: 'asc' },
    select: {
      id: true, startTime: true, format: true, audio: true, status: true,
      movie: { select: { id: true, title: true, slug: true, ageRating: true, posterUrl: true, durationMin: true } },
    },
  });

/**
 * Tìm các suất OPEN trong khoảng [from, to) theo nhiều điều kiện tùy chọn, dạng dữ liệu phẳng (cho trợ lý AI).
 * @internal
 * @param {{ from: Date, to: Date, movieId?: string, format?: string, cinemaId?: string, cityIds?: string[] }} filter
 */
export const searchOpenShowtimes = ({ from, to, movieId, format, cinemaId, cityIds }, db = prisma) =>
  db.showtime.findMany({
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

/**
 * Id các suất OPEN chưa bắt đầu của một phòng.
 * @internal
 */
export const listUpcomingShowtimeIds = ({ roomId, now }, db = prisma) =>
  db.showtime.findMany({ where: { roomId, status: 'OPEN', startTime: { gt: now } }, select: { id: true } });

/** Điều kiện lọc của trang quản trị: phòng, rạp, khoảng thời gian [from, to). */
const adminWhere = ({ roomId, cinemaId, from, to }) => ({
  ...(roomId && { roomId }),
  ...(cinemaId && { room: { cinemaId } }),
  ...(from && { startTime: { gte: from, lt: to } }),
});

/** @internal */
export const countAdminShowtimes = (filter, db = prisma) => db.showtime.count({ where: adminWhere(filter) });

/**
 * @param {{ roomId?: string, cinemaId?: string, from?: Date, to?: Date }} filter @param {{ skip: number, take: number }} page
 * @internal
 */
export const findAdminShowtimes = (filter, { skip, take }, db = prisma) =>
  db.showtime.findMany({ where: adminWhere(filter), orderBy: { startTime: 'asc' }, skip, take, select: ADMIN_SELECT });

/**
 * Có suất khác (chưa hủy) trong CÙNG PHÒNG chồng lấn thời gian không? Hai khoảng [s1,e1) và [s2,e2) chồng nhau khi
 * s1 < e2 VÀ e1 > s2; hai suất nối đuôi KHÔNG tính là trùng. Chạy trong transaction ĐÃ KHÓA phòng (lockRoom).
 * @internal
 * @returns {Promise<{ id: string }|null>} suất đang xung đột (nếu có)
 */
export const findOverlapInRoom = ({ roomId, startTime, endTime, excludeId }, db = prisma) =>
  db.showtime.findFirst({
    where: {
      roomId, status: 'OPEN', startTime: { lt: endTime }, endTime: { gt: startTime },
      ...(excludeId && { id: { not: excludeId } }),
    },
    select: { id: true },
  });

/**
 * Thêm suất. @returns {Promise<object>} theo `ADMIN_SELECT`
 * @internal
 */
export const insertShowtime = ({ movieId, roomId, startTime, endTime, format, audio, basePrice }, db = prisma) =>
  db.showtime.create({ data: { movieId, roomId, startTime, endTime, format, audio, basePrice }, select: ADMIN_SELECT });

/**
 * Các suất chưa hủy của một phòng chạm vào khoảng [from, to) — để xét trùng cho cả một lô.
 * @internal
 */
export const findOpenShowtimesInRoom = ({ roomId, from, to }, db = prisma) =>
  db.showtime.findMany({
    where: { roomId, status: 'OPEN', startTime: { lt: to }, endTime: { gt: from } },
    orderBy: { startTime: 'asc' },
    select: { id: true, startTime: true, endTime: true, movie: { select: { title: true } } },
  });

/** Thêm nhiều suất trong một câu lệnh. @internal */
export const insertShowtimes = (rows, db = prisma) => db.showtime.createMany({ data: rows });

/**
 * Cập nhật suất (service quyết định trường nào đổi). @returns {Promise<object>} theo `ADMIN_SELECT`
 * @internal
 */
export const updateShowtimeById = (showtimeId, data, db = prisma) =>
  db.showtime.update({ where: { id: showtimeId }, data, select: ADMIN_SELECT });

/**
 * @returns {Promise<object|null>} Showtime thô (không kèm quan hệ)
 * @internal
 */
export const getShowtimeById = (showtimeId, db = prisma) => db.showtime.findUnique({ where: { id: showtimeId } });

/**
 * Khóa tư vấn (advisory lock) theo phòng, tự nhả khi transaction kết thúc. Xếp hàng các thao tác thêm / sửa / hủy suất chiếu
 * trong cùng một phòng để "kiểm tra trùng giờ rồi mới ghi" không bị race. `tx` là BẮT BUỘC (khóa chỉ có nghĩa trong transaction).
 * @internal
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} roomId
 * @returns {Promise<number>}
 */
export const lockRoom = (tx, roomId) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${roomId}))`;
