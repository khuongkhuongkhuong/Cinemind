import { AppError } from '../utils/AppError.js';
import { env } from '../config/env.js';

// Các nhóm đường dẫn chứa dữ liệu cá nhân / token: trình duyệt hay proxy KHÔNG được lưu cache.
const NO_STORE = ['/api/v1/auth', '/api/v1/me', '/api/v1/orders', '/api/v1/payments', '/api/v1/staff', '/api/v1/admin'];

/**
 * Header bảo mật cho một API chỉ trả JSON (không có HTML).
 * - nosniff: trình duyệt không "đoán" kiểu nội dung (chặn JSON bị diễn giải thành script).
 * - frame-ancestors 'none' / X-Frame-Options: không cho nhúng API vào iframe (clickjacking).
 * - no-referrer: không rò rỉ URL (có thể chứa mã vé) sang trang khác.
 * - HSTS: chỉ production (yêu cầu trình duyệt luôn dùng HTTPS).
 * - Cache-Control: no-store cho các route chứa token / dữ liệu cá nhân.
 */
export function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    ...(env.NODE_ENV === 'production' && { 'Strict-Transport-Security': 'max-age=15552000; includeSubDomains' }),
    ...(NO_STORE.some((p) => req.path === p || req.path.startsWith(`${p}/`) || req.originalUrl.startsWith(`${p}/`) || req.originalUrl === p) && {
      'Cache-Control': 'no-store',
    }),
  });
  next();
}

/**
 * Từ chối ký tự NUL (\u0000) trong URL và JSON body. PostgreSQL không lưu / so sánh được chuỗi chứa NUL nên nếu để lọt
 * xuống DB sẽ thành lỗi 500 (và đầy log) chỉ bằng một request như `GET /movies/%00`.
 * Đặt SAU express.json() để kiểm được cả body.
 */
export function rejectNullBytes(req, res, next) {
  const reject = () => { throw new AppError('VALIDATION_ERROR', { message: 'Dữ liệu chứa ký tự không hợp lệ.' }); };
  let decoded;
  try {
    decoded = decodeURIComponent(req.originalUrl);
  } catch {
    return reject(); // chuỗi %xx hỏng
  }
  if (decoded.includes('\u0000')) reject();
  if (req.body && typeof req.body === 'object' && JSON.stringify(req.body).includes('\\u0000')) reject();
  next();
}
