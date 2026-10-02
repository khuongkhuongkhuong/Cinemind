// Đồng hồ theo giờ SERVER. Đếm ngược "giữ ghế 10 phút" phải dựa vào hạn do server đặt (expiresAt): nếu đồng hồ máy người dùng
// lệch vài phút thì đếm ngược sai (hết giờ sớm / muộn so với thực tế). Mỗi response của server có header `Date`, từ đó suy ra độ lệch.
let skewMs = 0;

/** Ghi nhận giờ server từ header `Date` của một response (bỏ qua nếu thiếu / sai định dạng). */
export function noteServerDate(dateHeader) {
  const server = Date.parse(dateHeader ?? '');
  if (Number.isFinite(server)) skewMs = server - Date.now();
}

/** Thời điểm hiện tại theo đồng hồ server (ms). */
export const serverNow = () => Date.now() + skewMs;

/** Còn bao nhiêu mili-giây tới `expiresAt` (ISO) theo đồng hồ server; không âm. */
export const msUntil = (expiresAt) => Math.max(0, Date.parse(expiresAt) - serverNow());

/** 523000 -> "08:43" */
export function formatCountdown(ms) {
  const total = Math.ceil(ms / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/** Chỉ dùng trong test. */
export const resetClock = () => { skewMs = 0; };
