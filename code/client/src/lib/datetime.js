// Ô nhập "ngày giờ" của trình duyệt (<input type="datetime-local">) không có múi giờ. Quản trị viên luôn nhập theo GIỜ VIỆT NAM;
// server lưu và nhận UTC (ISO 8601). Hai hàm này đổi qua lại, không phụ thuộc múi giờ của máy đang dùng.

const VN = '+07:00';

/** "2026-10-05T18:30" (giờ VN) -> "2026-10-05T11:30:00.000Z"; chuỗi sai trả null. */
export function vnInputToIso(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value ?? '')) return null;
  const d = new Date(`${value}:00${VN}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** "2026-10-05T11:30:00.000Z" -> "2026-10-05T18:30" (giờ VN) để điền vào ô nhập. */
export function isoToVnInput(iso) {
  const shifted = new Date(Date.parse(iso) + 7 * 3600_000);
  return Number.isNaN(shifted.getTime()) ? '' : shifted.toISOString().slice(0, 16);
}
