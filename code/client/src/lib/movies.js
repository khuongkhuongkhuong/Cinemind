// Hàm thuần liên quan tới phim / lịch chiếu (dễ test, không phụ thuộc React).

const FORMAT_LABEL = { F2D: '2D', F3D: '3D', IMAX: 'IMAX' };
const AUDIO_LABEL = { SUBTITLE: 'Phụ đề', DUBBED: 'Lồng tiếng' };
export const formatLabel = (format) => FORMAT_LABEL[format] ?? format;
export const audioLabel = (audio) => AUDIO_LABEL[audio] ?? audio;

/** "2D Phụ đề" */
export const showGroupLabel = ({ format, audio }) => `${formatLabel(format)} ${audioLabel(audio)}`;

/**
 * Tham số `status` trên URL của trang danh sách dùng từ ngắn gọn (`now` / `soon`, đúng docs/05) thay cho enum của API.
 * Giá trị lạ hoặc thiếu thì mặc định "đang chiếu".
 */
const URL_TO_STATUS = { now: 'NOW_SHOWING', soon: 'COMING_SOON' };
export const urlStatusToApi = (value) => URL_TO_STATUS[value] ?? 'NOW_SHOWING';
export const apiStatusToUrl = (status) => (status === 'COMING_SOON' ? 'soon' : 'now');

/** Số suất còn mở bán trong kết quả lịch chiếu (để báo "hết suất" khi tất cả đã đóng). */
export function countOpenShowtimes(schedule) {
  if (!schedule) return 0;
  return schedule.cinemas.reduce(
    (sum, c) => sum + c.groups.reduce((s, g) => s + g.showtimes.filter((t) => t.isOpenForSale).length, 0),
    0,
  );
}

/** Tổng số suất (kể cả đã đóng bán) trong kết quả lịch chiếu. */
export const countShowtimes = (schedule) =>
  (schedule?.cinemas ?? []).reduce((sum, c) => sum + c.groups.reduce((s, g) => s + g.showtimes.length, 0), 0);

/** Link trailer chỉ được mở nếu là http(s) (dữ liệu do admin nhập; chặn `javascript:` chui vào href). */
export const safeExternalUrl = (url) => {
  if (typeof url !== 'string') return null;
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
};

const YOUTUBE_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'];

/**
 * Link YouTube (watch?v=, youtu.be/, embed/, shorts/) -> địa chỉ nhúng vào trang; link khác trả null.
 * Chỉ ghép đúng mã video 11 ký tự vào một địa chỉ cố định, nên link do admin nhập không điều khiển được iframe trỏ đi nơi khác.
 */
export const youtubeEmbedUrl = (url) => {
  const safe = safeExternalUrl(url);
  if (!safe) return null;
  let parsed;
  try { parsed = new URL(safe); } catch { return null; }
  const parts = parsed.pathname.split('/').filter(Boolean);
  let id = null;
  if (parsed.hostname === 'youtu.be') [id] = parts;
  else if (YOUTUBE_HOSTS.includes(parsed.hostname)) {
    if (parts[0] === 'watch') id = parsed.searchParams.get('v');
    else if (parts[0] === 'embed' || parts[0] === 'shorts') id = parts[1];
  }
  return /^[\w-]{11}$/.test(id ?? '') ? `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0` : null;
};
