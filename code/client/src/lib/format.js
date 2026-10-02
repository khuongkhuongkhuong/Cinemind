// Mọi thời gian server trả về là UTC (ISO 8601); giao diện luôn hiển thị theo giờ Việt Nam (hợp đồng API mục 1).
const TZ = 'Asia/Ho_Chi_Minh';

const timeFmt = new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const dateFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }); // dd/MM/yyyy
const weekdayFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' });
const ymdFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }); // yyyy-MM-dd

const WEEKDAY = { Mon: 'T2', Tue: 'T3', Wed: 'T4', Thu: 'T5', Fri: 'T6', Sat: 'T7', Sun: 'CN' };
const toDate = (value) => (value instanceof Date ? value : new Date(value));

/** 154000 -> "154.000đ" */
export const formatMoney = (amount) => `${new Intl.NumberFormat('vi-VN').format(amount ?? 0)}đ`;

/** "2026-10-02T12:45:00.000Z" -> "19:45" */
export const formatTime = (value) => timeFmt.format(toDate(value));

/** -> "02/10/2026" */
export const formatDate = (value) => dateFmt.format(toDate(value));

/** -> "T5" (thứ trong tuần theo giờ VN) */
export const formatWeekday = (value) => WEEKDAY[weekdayFmt.format(toDate(value))];

/** -> "19:45 T5 02/10/2026" */
export const formatDateTime = (value) => `${formatTime(value)} ${formatWeekday(value)} ${formatDate(value)}`;

/** Ngày theo giờ VN dạng "YYYY-MM-DD" — đúng định dạng tham số `date` của API lịch chiếu. */
export const vnDateKey = (value = new Date()) => ymdFmt.format(toDate(value));

/**
 * `count` ngày liên tiếp bắt đầu từ hôm nay (giờ VN), cho bộ chọn ngày: [{ key: '2026-10-02', weekday: 'T5', label: '02/10' }, ...]
 * @param {number} count
 * @param {Date} [from]
 */
export function nextDays(count = 7, from = new Date()) {
  const todayKey = vnDateKey(from);
  // Dùng 12:00 giờ VN làm mốc để cộng ngày không bị lệch do múi giờ.
  const base = new Date(`${todayKey}T12:00:00+07:00`);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(base.getTime() + i * 86_400_000);
    const [y, m, day] = vnDateKey(d).split('-');
    return { key: `${y}-${m}-${day}`, weekday: formatWeekday(d), label: `${day}/${m}` };
  });
}

export const formatDuration = (minutes) => `${minutes} phút`;

/** Ngày thuần "2026-09-12" (kiểu @db.Date của server) -> "12/09/2026". Tách chuỗi thay vì dùng Date để không bị lệch múi giờ. */
export function formatDateOnly(value) {
  const [y, m, d] = String(value).split('-');
  return y && m && d ? `${d}/${m}/${y}` : String(value ?? '');
}
