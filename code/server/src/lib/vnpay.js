import { createHmac, timingSafeEqual } from 'node:crypto';
import { VN_OFFSET_MS } from './time.js';

// Thư viện kỹ thuật cho VNPay (v2.1.0) — chỉ ký/kiểm chữ ký, KHÔNG chứa luật nghiệp vụ và không đụng DB.

/** Date -> "yyyyMMddHHmmss" theo giờ Việt Nam (VNPay yêu cầu GMT+7). */
export function formatVnpDate(date) {
  const d = new Date(date.getTime() + VN_OFFSET_MS);
  const p = (n, len = 2) => String(n).padStart(len, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

// VNPay mã hóa giá trị kiểu encodeURIComponent nhưng khoảng trắng là "+".
const encode = (value) => encodeURIComponent(value).replace(/%20/g, '+');

/** Chuỗi "k1=v1&k2=v2" với khóa xếp theo thứ tự chữ cái, giá trị đã mã hóa — vừa là dữ liệu ký, vừa là query string. */
export function buildQuery(params) {
  return Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map((k) => `${k}=${encode(String(params[k]))}`)
    .join('&');
}

/** Chữ ký HMAC-SHA512 (hex) của các tham số, không tính chính vnp_SecureHash. */
export function sign(params, secret) {
  const { vnp_SecureHash: _h, vnp_SecureHashType: _t, ...rest } = params;
  return createHmac('sha512', secret).update(buildQuery(rest), 'utf8').digest('hex');
}

/** URL thanh toán đã ký, client chỉ việc chuyển hướng tới. */
export function buildPaymentUrl({ baseUrl, params, secret }) {
  return `${baseUrl}?${buildQuery(params)}&vnp_SecureHash=${sign(params, secret)}`;
}

/**
 * Kiểm chữ ký của một IPN/return. So sánh "thời gian không đổi" (timingSafeEqual) để kẻ tấn công
 * không đoán dần từng ký tự của chữ ký qua chênh lệch thời gian phản hồi.
 * @param {Record<string, string>} query toàn bộ query vnp_* nhận được
 */
export function verifySignature(query, secret) {
  const received = String(query.vnp_SecureHash ?? '').toLowerCase();
  const expected = sign(query, secret);
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
