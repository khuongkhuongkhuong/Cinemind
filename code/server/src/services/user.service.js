import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { issueTokens } from './auth.service.js';

/** Chỉ các trường an toàn — tuyệt đối không có passwordHash. */
const publicUser = (u) => ({ id: u.id, email: u.email, fullName: u.fullName, phone: u.phone, role: u.role, points: u.points });

/** Lấy user đang đăng nhập và chắc chắn còn tồn tại / chưa bị khóa (requireAuth không hỏi DB). */
async function loadActiveUser(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('UNAUTHORIZED');
  if (!user.isActive) throw new AppError('ACCOUNT_DISABLED');
  return user;
}

/**
 * Sửa hồ sơ cá nhân (FR-16). CHỈ họ tên và số điện thoại: email, vai trò, điểm... không đổi được qua đây
 * (validator từ chối mọi trường lạ để không ai tự nâng quyền bằng cách nhét `role` vào body).
 * @param {{ userId: string, fullName?: string, phone?: string | null }} params phone = null để xóa số
 * @returns {Promise<object>} user công khai
 * @throws {AppError} UNAUTHORIZED | ACCOUNT_DISABLED
 */
export async function updateProfile({ userId, fullName, phone }) {
  await loadActiveUser(userId);
  const user = await prisma.user.update({
    where: { id: userId },
    data: { ...(fullName !== undefined && { fullName }), ...(phone !== undefined && { phone }) },
  });
  return publicUser(user);
}

/**
 * Đổi mật khẩu. Yêu cầu mật khẩu hiện tại (người lỡ để quên máy mở / lấy được access token cũng không đổi được).
 * Đổi xong THU HỒI MỌI refresh token của user (đăng xuất mọi thiết bị khác), rồi cấp một refresh token mới cho
 * thiết bị đang thao tác để người dùng không bị văng. Access token cũ vẫn dùng được tới khi hết hạn (tối đa 15 phút).
 * Sai mật khẩu hiện tại trả VALIDATION_ERROR (400), KHÔNG phải 401: client dùng 401 để hiểu là "hết phiên".
 * @param {{ userId: string, currentPassword: string, newPassword: string }} params
 * @returns {Promise<{ refreshToken: string }>} refresh token mới cho thiết bị hiện tại
 * @throws {AppError} UNAUTHORIZED | ACCOUNT_DISABLED | VALIDATION_ERROR
 */
export async function changePassword({ userId, currentPassword, newPassword }) {
  const user = await loadActiveUser(userId);
  const fieldError = (field, message) => new AppError('VALIDATION_ERROR', { details: { fields: { [field]: message } } });

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw fieldError('currentPassword', 'Mật khẩu hiện tại không đúng.');
  }
  if (currentPassword === newPassword) throw fieldError('newPassword', 'Mật khẩu mới phải khác mật khẩu hiện tại.');

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  const { refreshToken } = await issueTokens(user);
  return { refreshToken };
}

/**
 * Vai trò và trạng thái HIỆN TẠI của tài khoản trong DB (không tin vai trò ghi trong access token).
 * @param {{ userId: string }} params
 * @returns {Promise<{ role: string, isActive: boolean } | null>} null nếu tài khoản không còn tồn tại
 */
export const getAccountState = ({ userId }) =>
  prisma.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true } });
