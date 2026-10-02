// Chuyển đổi + kiểm tra biểu mẫu quản trị. Tách khỏi component để test được bằng Vitest thuần.
// Kiểm tra ở trình duyệt chỉ để báo lỗi nhanh; server (zod) vẫn kiểm tra lại và là nguồn quyết định.
import { isoToVnInput, vnInputToIso } from './datetime';

const isHttpUrl = (v) => /^https?:\/\/\S+$/i.test(v);
const orNull = (v) => (v.trim() === '' ? null : v.trim());
const isMoney = (v) => v !== '' && Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 5_000_000;

export const EMPTY_MOVIE = {
  title: '', description: '', durationMin: '', ageRating: 'T13', releaseDate: '', status: 'COMING_SOON',
  director: '', actors: '', language: '', posterUrl: '', trailerUrl: '', genreIds: [],
};

export const movieToForm = (m) => ({
  title: m.title, description: m.description ?? '', durationMin: String(m.durationMin), ageRating: m.ageRating,
  releaseDate: m.releaseDate, status: m.status, director: m.director ?? '', actors: m.actors ?? '',
  language: m.language ?? '', posterUrl: m.posterUrl ?? '', trailerUrl: m.trailerUrl ?? '', genreIds: (m.genres ?? []).map((g) => g.id),
});

export function validateMovie(f) {
  const e = {};
  if (!f.title.trim()) e.title = 'Vui lòng nhập tên phim';
  if (!f.description.trim()) e.description = 'Vui lòng nhập mô tả';
  const d = Number(f.durationMin);
  if (f.durationMin === '' || !Number.isInteger(d) || d < 1 || d > 600) e.durationMin = 'Thời lượng là số nguyên từ 1 đến 600 phút';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.releaseDate)) e.releaseDate = 'Vui lòng chọn ngày khởi chiếu';
  if (f.posterUrl.trim() && !isHttpUrl(f.posterUrl.trim())) e.posterUrl = 'URL phải bắt đầu bằng http:// hoặc https://';
  if (f.trailerUrl.trim() && !isHttpUrl(f.trailerUrl.trim())) e.trailerUrl = 'URL phải bắt đầu bằng http:// hoặc https://';
  return e;
}

/** Khi sửa không gửi `status` (đổi trạng thái có API riêng; schema server .strict() sẽ từ chối trường lạ). */
export function movieToBody(f, isCreate) {
  const body = {
    title: f.title.trim(), description: f.description.trim(), durationMin: Number(f.durationMin), ageRating: f.ageRating,
    releaseDate: f.releaseDate, director: orNull(f.director), actors: orNull(f.actors), language: orNull(f.language),
    posterUrl: orNull(f.posterUrl), trailerUrl: orNull(f.trailerUrl), genreIds: f.genreIds,
  };
  if (isCreate) body.status = f.status;
  return body;
}

export const EMPTY_SHOWTIME = { movieId: '', roomId: '', start: '', format: 'F2D', audio: 'SUBTITLE', basePrice: '' };

export const showtimeToForm = (s) => ({
  movieId: s.movie.id, roomId: s.room.id, start: isoToVnInput(s.startTime), format: s.format, audio: s.audio, basePrice: String(s.basePrice),
});

export function validateShowtime(f, now = Date.now()) {
  const e = {};
  if (!f.movieId) e.movieId = 'Vui lòng chọn phim';
  if (!f.roomId) e.roomId = 'Vui lòng chọn phòng';
  const iso = vnInputToIso(f.start);
  if (!iso) e.start = 'Vui lòng nhập giờ chiếu';
  else if (Date.parse(iso) <= now) e.start = 'Giờ chiếu phải ở tương lai';
  if (f.basePrice !== '' && !isMoney(f.basePrice)) e.basePrice = 'Giá là số nguyên từ 0 đến 5.000.000';
  return e;
}

/** Để trống giá gốc = để server tự tra bảng giá (đúng nghiệp vụ: server tự tính tiền). */
export function showtimeToBody(f) {
  const body = { movieId: f.movieId, roomId: f.roomId, startTime: vnInputToIso(f.start), format: f.format, audio: f.audio };
  if (f.basePrice !== '') body.basePrice = Number(f.basePrice);
  return body;
}

/** Bảng giá: mảng từ server -> các ô nhập (chuỗi) và ngược lại. */
export function pricingToForm(p) {
  return {
    rules: Object.fromEntries(p.priceRules.map((r) => [`${r.format}|${r.dayType}`, r.basePrice == null ? '' : String(r.basePrice)])),
    surcharges: Object.fromEntries(p.surcharges.map((s) => [s.seatType, String(s.surcharge)])),
  };
}
export function validatePricing(f) {
  const e = {};
  Object.entries(f.rules).forEach(([k, v]) => { if (!isMoney(v)) e[`rule:${k}`] = 'Số nguyên 0–5.000.000'; });
  Object.entries(f.surcharges).forEach(([k, v]) => { if (!isMoney(v)) e[`sur:${k}`] = 'Số nguyên 0–5.000.000'; });
  return e;
}
export const pricingToBody = (f) => ({
  priceRules: Object.entries(f.rules).map(([k, v]) => { const [format, dayType] = k.split('|'); return { format, dayType, basePrice: Number(v) }; }),
  surcharges: Object.entries(f.surcharges).map(([seatType, v]) => ({ seatType, surcharge: Number(v) })),
});
