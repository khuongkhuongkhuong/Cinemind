import { AppError } from '../utils/AppError.js';
import { env } from '../config/env.js';

/**
 * Giới hạn số lần gọi theo IP trong một khung thời gian (bộ nhớ trong tiến trình).
 * Giới hạn: chỉ đúng khi chạy 1 server; nhiều server cần Redis (đề tài chưa dùng Redis).
 * Khi chạy sau proxy phải đặt TRUST_PROXY, nếu không mọi khách cùng dùng chung một bộ đếm (IP của proxy).
 */
export function rateLimit({ windowMs, max, enabled = env.NODE_ENV !== 'test' }) {
  const hits = new Map(); // ip -> { count, resetAt }

  // Dọn các IP đã hết khung thời gian; nếu không Map chỉ lớn lên (mỗi IP lạ để lại một mục mãi mãi).
  // unref(): bộ hẹn giờ này không giữ tiến trình sống (test / tắt server vẫn thoát bình thường).
  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of hits) if (entry.resetAt <= now) hits.delete(ip);
  }, Math.min(windowMs, 60_000)).unref();

  return (req, res, next) => {
    if (!enabled) return next(); // test tích hợp tắt để không bị chặn; test riêng của limiter bật bằng enabled: true
    const now = Date.now();
    const entry = hits.get(req.ip);
    if (!entry || entry.resetAt <= now) {
      hits.set(req.ip, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (++entry.count > max) throw new AppError('RATE_LIMITED');
    next();
  };
}
