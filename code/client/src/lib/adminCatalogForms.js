// Biểu mẫu quản trị cho combo, khuyến mãi, banner, nhân viên (tách riêng để test bằng Vitest thuần).
// Kiểm tra ở trình duyệt chỉ để báo lỗi nhanh; server (zod) vẫn kiểm tra lại và là nguồn quyết định.
import { isoToVnInput, vnInputToIso } from './datetime';

const isHttpUrl = (v) => /^https?:\/\/\S+$/i.test(v);
const orNull = (v) => (v.trim() === '' ? null : v.trim());
const posInt = (v, min, max) => v !== '' && Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max;

// ---- Combo ----
export const EMPTY_COMBO = { name: '', description: '', price: '', imageUrl: '', isActive: true };
export const comboToForm = (c) => ({ name: c.name, description: c.description ?? '', price: String(c.price), imageUrl: c.imageUrl ?? '', isActive: c.isActive });
export function validateCombo(f) {
  const e = {};
  if (!f.name.trim()) e.name = 'Vui lòng nhập tên combo';
  if (!posInt(f.price, 0, 10_000_000)) e.price = 'Giá là số nguyên từ 0 đến 10.000.000';
  if (f.imageUrl.trim() && !isHttpUrl(f.imageUrl.trim())) e.imageUrl = 'URL phải bắt đầu bằng http:// hoặc https://';
  return e;
}
export const comboToBody = (f) => ({ name: f.name.trim(), description: orNull(f.description), price: Number(f.price), imageUrl: orNull(f.imageUrl), isActive: f.isActive });

// ---- Khuyến mãi ----
export const EMPTY_PROMO = { code: '', name: '', description: '', discountType: 'PERCENT', discountValue: '', maxDiscount: '', minOrderValue: '0', start: '', end: '', usageLimit: '', isActive: true };
export const promoToForm = (p) => ({
  code: p.code, name: p.name, description: p.description ?? '', discountType: p.discountType, discountValue: String(p.discountValue),
  maxDiscount: p.maxDiscount == null ? '' : String(p.maxDiscount), minOrderValue: String(p.minOrderValue),
  start: isoToVnInput(p.startAt), end: isoToVnInput(p.endAt), usageLimit: p.usageLimit == null ? '' : String(p.usageLimit), isActive: p.isActive,
});
export function validatePromo(f, isCreate) {
  const e = {};
  if (isCreate && !/^[A-Za-z0-9_-]{3,30}$/.test(f.code.trim())) e.code = 'Mã gồm 3–30 ký tự chữ, số, "-" hoặc "_"';
  if (!f.name.trim()) e.name = 'Vui lòng nhập tên';
  const isPercent = f.discountType === 'PERCENT';
  if (!posInt(f.discountValue, 1, isPercent ? 100 : 100_000_000)) e.discountValue = isPercent ? 'Phần trăm từ 1 đến 100' : 'Số tiền giảm là số nguyên dương';
  if (f.maxDiscount !== '' && !posInt(f.maxDiscount, 1, 100_000_000)) e.maxDiscount = 'Số nguyên dương';
  if (!posInt(f.minOrderValue, 0, 100_000_000)) e.minOrderValue = 'Số nguyên từ 0';
  if (f.usageLimit !== '' && !posInt(f.usageLimit, 1, 10_000_000)) e.usageLimit = 'Số nguyên dương';
  const s = vnInputToIso(f.start);
  const t = vnInputToIso(f.end);
  if (!s) e.start = 'Vui lòng nhập thời điểm bắt đầu';
  if (!t) e.end = 'Vui lòng nhập thời điểm kết thúc';
  else if (s && Date.parse(t) <= Date.parse(s)) e.end = 'Kết thúc phải sau bắt đầu';
  return e;
}
/** Khi sửa không gửi `code` (mã không đổi được; schema server .strict() sẽ từ chối). maxDiscount chỉ có nghĩa với PERCENT. */
export function promoToBody(f, isCreate) {
  const body = {
    name: f.name.trim(), description: orNull(f.description), discountType: f.discountType, discountValue: Number(f.discountValue),
    maxDiscount: f.discountType === 'PERCENT' && f.maxDiscount !== '' ? Number(f.maxDiscount) : null, minOrderValue: Number(f.minOrderValue),
    startAt: vnInputToIso(f.start), endAt: vnInputToIso(f.end), usageLimit: f.usageLimit === '' ? null : Number(f.usageLimit), isActive: f.isActive,
  };
  if (isCreate) body.code = f.code.trim().toUpperCase();
  return body;
}

// ---- Banner ----
export const EMPTY_BANNER = { title: '', imageUrl: '', linkUrl: '', sortOrder: '0', isActive: true, start: '', end: '' };
export const bannerToForm = (b) => ({
  title: b.title, imageUrl: b.imageUrl, linkUrl: b.linkUrl ?? '', sortOrder: String(b.sortOrder), isActive: b.isActive,
  start: b.startAt ? isoToVnInput(b.startAt) : '', end: b.endAt ? isoToVnInput(b.endAt) : '',
});
/** URL an toàn: http(s) hoặc đường dẫn nội bộ "/x" — KHÔNG nhận "//host" (open redirect) hay "javascript:" (XSS). */
export const isSafeUrl = (v) => isHttpUrl(v) || /^\/(?!\/)[A-Za-z0-9\-._~%/?=&#]*$/.test(v);
const URL_MSG = 'Phải là URL http(s):// hoặc đường dẫn bắt đầu bằng "/"';
export function validateBanner(f) {
  const e = {};
  if (!f.title.trim()) e.title = 'Vui lòng nhập tiêu đề';
  if (!f.imageUrl.trim()) e.imageUrl = 'Vui lòng nhập URL ảnh';
  else if (!isSafeUrl(f.imageUrl.trim())) e.imageUrl = URL_MSG;
  if (f.linkUrl.trim() && !isSafeUrl(f.linkUrl.trim())) e.linkUrl = URL_MSG;
  if (!posInt(f.sortOrder, 0, 10_000)) e.sortOrder = 'Số nguyên từ 0 đến 10.000';
  const s = f.start ? vnInputToIso(f.start) : null;
  const t = f.end ? vnInputToIso(f.end) : null;
  if (f.start && !s) e.start = 'Thời điểm không hợp lệ';
  if (f.end && !t) e.end = 'Thời điểm không hợp lệ';
  if (s && t && Date.parse(t) <= Date.parse(s)) e.end = 'Kết thúc phải sau bắt đầu';
  return e;
}
export const bannerToBody = (f) => ({
  title: f.title.trim(), imageUrl: f.imageUrl.trim(), linkUrl: orNull(f.linkUrl), sortOrder: Number(f.sortOrder), isActive: f.isActive,
  startAt: f.start ? vnInputToIso(f.start) : null, endAt: f.end ? vnInputToIso(f.end) : null,
});

// ---- Nhân viên ----
export const EMPTY_STAFF = { fullName: '', email: '', phone: '', password: '' };
export function validateStaff(f) {
  const e = {};
  if (!f.fullName.trim()) e.fullName = 'Vui lòng nhập họ tên';
  if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) e.email = 'Email không hợp lệ';
  if (f.phone.trim() && !/^0\d{9}$/.test(f.phone.trim())) e.phone = 'Số điện thoại gồm 10 chữ số, bắt đầu bằng 0';
  if (f.password.length < 8) e.password = 'Mật khẩu tối thiểu 8 ký tự';
  else if (f.password.length > 72) e.password = 'Mật khẩu tối đa 72 ký tự';
  return e;
}
/** Không có `role`: tạo qua API này luôn là STAFF (server .strict() từ chối trường lạ). */
export const staffToBody = (f) => ({ fullName: f.fullName.trim(), email: f.email.trim(), password: f.password, ...(f.phone.trim() && { phone: f.phone.trim() }) });

// ---- Biểu đồ doanh thu ----
/** Chiều cao cột (%) theo doanh thu lớn nhất; doanh thu > 0 luôn có tối thiểu 2% để còn thấy được. */
export function barHeights(rows) {
  const max = Math.max(0, ...rows.map((r) => r.revenue));
  return rows.map((r) => (max === 0 || r.revenue === 0 ? 0 : Math.max(2, Math.round((r.revenue / max) * 100))));
}
export const sumRevenue = (rows) => rows.reduce((a, r) => ({ revenue: a.revenue + r.revenue, ticketCount: a.ticketCount + r.ticketCount, orderCount: a.orderCount + r.orderCount }), { revenue: 0, ticketCount: 0, orderCount: 0 });
