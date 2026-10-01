import { AppError } from '../utils/AppError.js';
import { verifyAccessToken } from '../lib/jwt.js';
import { getAccountState } from '../services/user.service.js';

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

/**
 * Như requireRole nhưng đối chiếu với DB: vai trò và trạng thái được đọc LẠI ở mỗi request thay vì tin access token.
 * Nhờ vậy khóa tài khoản / hạ quyền có hiệu lực NGAY trên các route đặc quyền, không phải chờ token hết hạn (15 phút).
 * Dùng cho /admin/* và /staff/*; route khách hàng thường vẫn chỉ dùng requireAuth (nhanh hơn, chấp nhận độ trễ tối đa 15 phút).
 * Dùng SAU requireAuth.
 */
export const requireFreshRole = (...roles) => async (req, res, next) => {
  const account = await getAccountState({ userId: req.user.id });
  if (!account) throw new AppError('UNAUTHORIZED');
  if (!account.isActive) throw new AppError('ACCOUNT_DISABLED');
  if (!roles.includes(account.role)) throw new AppError('FORBIDDEN');
  req.user.role = account.role;
  next();
};
