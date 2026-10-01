import { AppError } from '../utils/AppError.js';
import { env } from '../config/env.js';

/**
 * Giới hạn số lần gọi theo IP trong một khung thời gian (bộ nhớ trong tiến trình).
 * Giới hạn: chỉ đúng khi chạy 1 server; nhiều server cần Redis (đề tài chưa dùng Redis).
 */
export function rateLimit({ windowMs, max }) {
  const hits = new Map(); // ip -> { count, resetAt }
  return (req, res, next) => {
    if (env.NODE_ENV === 'test') return next();
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
