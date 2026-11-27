// Hàm thuần cho trang Tổng quan (A01): thang trục tiền, nhãn ngày, so sánh với kỳ trước.

const DAY_MS = 86_400_000;
const shift = (key, days) => new Date(Date.parse(`${key}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

export const daysBefore = (key, n) => shift(key, -n);

/** Kỳ liền trước, dài bằng kỳ đang xem: [from, to] -> [from − n, from − 1]. */
export function previousRange(from, to) {
  const length = Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
  return { from: shift(from, -length), to: shift(from, -1) };
}

/** Mức tăng / giảm so với kỳ trước. Kỳ trước bằng 0 thì không tính phần trăm (trả null). */
export function change(current, previous) {
  if (!previous) return null;
  const percent = Math.round(((current - previous) / previous) * 100);
  return { percent: Math.abs(percent), direction: percent > 0 ? 'up' : percent < 0 ? 'down' : 'flat' };
}

/** Các mốc chia trục tiền tròn số, từ 0 đến mốc đầu tiên ≥ giá trị lớn nhất (khoảng 4 vạch). */
export function niceTicks(max, count = 4) {
  if (!(max > 0)) return [0, 1];
  const rough = max / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rough);
  const ticks = [0];
  while (ticks.at(-1) < max) ticks.push(ticks.at(-1) + step);
  return ticks;
}

const number = (n) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(n);

/** Nhãn gọn cho trục: 2.500.000 -> "2,5 tr"; 500.000 -> "500k". */
export function compactMoney(amount) {
  if (amount >= 1_000_000) return `${number(amount / 1_000_000)} tr`;
  if (amount >= 1_000) return `${number(amount / 1_000)}k`;
  return number(amount);
}

/** Chỉ số các cột được ghi nhãn ngày: cách đều, tối đa `max` nhãn, luôn có cột cuối. */
export function labelIndexes(length, max = 8) {
  const every = Math.max(1, Math.ceil(length / max));
  return new Set(Array.from({ length }, (_, i) => length - 1 - i).filter((_, i) => i % every === 0));
}

/** "2026-11-27" -> "27/11" */
export const shortDate = (key) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;
