import { AppError } from '../utils/AppError.js';
import { verifyAccessToken } from '../lib/jwt.js';

/** Bắt buộc đăng nhập: đọc header `Authorization: Bearer <token>`, gắn `req.user = { id, role }`. */
export function requireAuth(req, res, next) {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  if (scheme !== 'Bearer' || !token) throw new AppError('UNAUTHORIZED');
  req.user = verifyAccessToken(token); // ném TOKEN_EXPIRED / UNAUTHORIZED
  next();
}

/**
 * Giới hạn theo vai trò. Dùng SAU requireAuth: router.get('/x', requireAuth, requireRole('ADMIN'), ...)
 * Quy ước (04 mục 1.4): STAFF = STAFF hoặc ADMIN; ADMIN = chỉ ADMIN.
 */
export const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) throw new AppError('FORBIDDEN');
  next();
};
