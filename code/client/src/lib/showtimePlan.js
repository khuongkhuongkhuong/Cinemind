// Hàm thuần cho trang xếp lịch (A03): đặt khối trên trục thời gian và đọc dữ liệu của form tạo hàng loạt.

export const AXIS_START_MIN = 8 * 60; // trục bắt đầu 08:00 giờ VN
const DAY_MIN = 24 * 60;
export const BULK_MAX_DAYS = 31;
export const BULK_MAX_TIMES = 12;

const pad = (n) => String(n).padStart(2, '0');
const dayStartMs = (date) => Date.parse(`${date}T00:00:00+07:00`);

/** Số phút kể từ 00:00 (giờ VN) của ngày `date`; suất kéo qua nửa đêm cho giá trị lớn hơn 1440. */
export const minutesFrom = (iso, date) => Math.round((Date.parse(iso) - dayStartMs(date)) / 60_000);

/** Chỉ các suất BẮT ĐẦU trong ngày `date`: suất của ngày khác mà lọt vào sẽ kéo trục giờ dài vô lý. */
export const startingOn = (showtimes, date) => showtimes.filter((s) => {
  const min = minutesFrom(s.startTime, date);
  return min >= 0 && min < DAY_MIN;
});

/** Khoảng của trục: từ 08:00 (sớm hơn nếu có suất sớm hơn) đến ít nhất 24:00, tròn giờ để chứa hết các suất. */
export function axisRange(showtimes, date) {
  const starts = showtimes.map((s) => minutesFrom(s.startTime, date));
  const ends = showtimes.map((s) => minutesFrom(s.endTime, date));
  const start = Math.floor(Math.min(AXIS_START_MIN, ...starts) / 60) * 60;
  const end = Math.ceil(Math.max(DAY_MIN, ...ends) / 60) * 60;
  return { start, end };
}

/** "13:05"; quá nửa đêm quay lại 00:xx. */
export const clockLabel = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;

/**
 * Bấm vào chỗ trống: tỉ lệ vị trí (0..1) trên hàng -> giá trị cho ô "datetime-local" (giờ VN), làm tròn xuống 5 phút.
 */
export function slotValue(fraction, { start, end }, date) {
  const clamped = Math.min(Math.max(fraction, 0), 1);
  const min = Math.floor((start + clamped * (end - start)) / 5) * 5;
  const at = new Date(dayStartMs(date) + min * 60_000 + 7 * 3600_000); // đồng hồ VN đọc bằng getUTC*
  return at.toISOString().slice(0, 16);
}

/** "9:00, 13h30 19.45" -> { times: ['09:00','13:30','19:45'], invalid: [] } (bỏ trùng, xếp tăng dần). */
export function parseTimes(text) {
  const times = new Set();
  const invalid = [];
  for (const raw of String(text).split(/[\s,;]+/).filter(Boolean)) {
    const m = /^(\d{1,2})[:h.](\d{2})$/i.exec(raw);
    if (m && Number(m[1]) < 24 && Number(m[2]) < 60) times.add(`${pad(Number(m[1]))}:${m[2]}`);
    else invalid.push(raw);
  }
  return { times: [...times].sort(), invalid };
}

/** Mọi ngày từ `from` đến `to` (YYYY-MM-DD, gồm cả hai đầu). Trả [] nếu thiếu hoặc ngược; dừng sau BULK_MAX_DAYS + 1 ngày. */
export function dateList(from, to) {
  const first = Date.parse(`${from}T00:00:00Z`);
  const last = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(first) || Number.isNaN(last) || last < first) return [];
  const days = [];
  for (let t = first; t <= last && days.length <= BULK_MAX_DAYS; t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));
  return days;
}

export const CLEANING_MIN = 15; // khớp server: endTime = thời lượng + 15 phút dọn phòng

/**
 * Giá trị ô "datetime-local" (giờ VN) + thời lượng phim -> mốc bắt đầu, phim kết thúc, phòng trống lại (ISO).
 * Thiếu giờ hoặc thời lượng thì trả null.
 */
export function planSlot(startInput, durationMin) {
  const startMs = Date.parse(`${startInput}:00+07:00`);
  if (Number.isNaN(startMs) || !(durationMin > 0)) return null;
  const at = (min) => new Date(startMs + min * 60_000).toISOString();
  return { start: at(0), filmEnd: at(durationMin), roomFree: at(durationMin + CLEANING_MIN) };
}

/** Giờ PHIM kết thúc của một suất: `endTime` của server đã gồm thời gian dọn phòng. */
export const filmEndOf = (showtime) => new Date(Date.parse(showtime.endTime) - CLEANING_MIN * 60_000).toISOString();

/** Id phim xếp theo số suất giảm dần (bằng nhau thì theo id) — phim nhiều suất được cấp màu riêng trước. */
export function moviesByShowCount(showtimes) {
  const count = new Map();
  for (const s of showtimes) count.set(s.movie.id, (count.get(s.movie.id) ?? 0) + 1);
  return [...count.keys()].sort((a, b) => count.get(b) - count.get(a) || a.localeCompare(b));
}

/** Các suất chồng lên khoảng [start, roomFree); nối đuôi thì không tính (cùng quy tắc với server). */
export const findClashes = (showtimes, { start, roomFree }) =>
  showtimes.filter((s) => Date.parse(s.startTime) < Date.parse(roomFree) && Date.parse(s.endTime) > Date.parse(start));

export const EMPTY_BULK = { movieId: '', roomId: '', from: '', to: '', times: '', format: 'F2D', audio: 'SUBTITLE', basePrice: '' };

/** Kiểm tra phía trình duyệt cho nhanh; server vẫn kiểm tra lại. */
export function validateBulk(f) {
  const e = {};
  if (!f.movieId) e.movieId = 'Vui lòng chọn phim';
  if (!f.roomId) e.roomId = 'Vui lòng chọn phòng';
  const days = dateList(f.from, f.to);
  if (!f.from) e.from = 'Vui lòng chọn ngày bắt đầu';
  if (!f.to) e.to = 'Vui lòng chọn ngày kết thúc';
  else if (f.from && !days.length) e.to = 'Ngày kết thúc phải từ ngày bắt đầu trở đi';
  else if (days.length > BULK_MAX_DAYS) e.to = `Tối đa ${BULK_MAX_DAYS} ngày một lần`;
  const { times, invalid } = parseTimes(f.times);
  if (invalid.length) e.times = `Giờ không hợp lệ: ${invalid.join(', ')} (viết dạng 09:00)`;
  else if (!times.length) e.times = 'Nhập ít nhất một giờ chiếu';
  else if (times.length > BULK_MAX_TIMES) e.times = `Tối đa ${BULK_MAX_TIMES} giờ`;
  if (f.basePrice !== '' && !(Number.isInteger(Number(f.basePrice)) && Number(f.basePrice) >= 0 && Number(f.basePrice) <= 5_000_000)) {
    e.basePrice = 'Giá là số nguyên từ 0 đến 5.000.000';
  }
  return e;
}

export function bulkToBody(f, dryRun) {
  const body = {
    movieId: f.movieId, roomId: f.roomId, dates: dateList(f.from, f.to), times: parseTimes(f.times).times,
    format: f.format, audio: f.audio, dryRun,
  };
  if (f.basePrice !== '') body.basePrice = Number(f.basePrice);
  return body;
}
