import { runInTransaction } from '../dao/transaction.js';
import { findToken, insertRefreshToken, revokeAllOfUser, revokeIfValid, revokeToken } from '../dao/refreshToken.dao.js';
import { AppError } from '../utils/AppError.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import {
  REFRESH_TTL_MS, signAccessToken, generateRefreshToken, hashRefreshToken,
} from '../lib/jwt.js';
import * as userService from './user.service.js';

// Hash giả để so sánh khi email không tồn tại -> thời gian phản hồi giống nhau, không lộ email nào đã đăng ký.
const DUMMY_HASH = await hashPassword('mat-khau-gia-khong-ai-dung');

/** Chỉ trả các trường an toàn — tuyệt đối không có passwordHash. */
const toPublicUser = (u) => ({
  id: u.id, email: u.email, fullName: u.fullName, phone: u.phone, role: u.role, points: u.points,
});

export async function issueTokens(user) {
  const refreshToken = generateRefreshToken();
  await insertRefreshToken({
    userId: user.id,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
  });
  return { accessToken: signAccessToken(user), refreshToken };
}

/**
 * Đăng ký tài khoản USER mới.
 * @param {{ email: string, password: string, fullName: string, phone?: string }} params
 * @returns {Promise<{ user: object, accessToken: string, refreshToken: string }>}
 * @throws {AppError} EMAIL_EXISTS
 */
export async function register({ email, password, fullName, phone }) {
  const passwordHash = await hashPassword(password);
  try {
    // Ghi thẳng và để UNIQUE(email) làm trọng tài (giống tinh thần chống trùng ghế), không "check rồi insert".
    const user = await userService.createUser({ email, passwordHash, fullName, phone: phone ?? null });
    return { user: toPublicUser(user), ...(await issueTokens(user)) };
  } catch (err) {
    if (err.code === 'P2002') throw new AppError('EMAIL_EXISTS');
    throw err;
  }
}

/**
 * Đăng nhập.
 * @param {{ email: string, password: string }} params
 * @returns {Promise<{ user: object, accessToken: string, refreshToken: string }>}
 * @throws {AppError} INVALID_CREDENTIALS | ACCOUNT_DISABLED
 */
export async function login({ email, password }) {
  const user = await userService.findUserByEmail(email);
  const passwordOk = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  // Sai email và sai mật khẩu trả CÙNG một lỗi để kẻ tấn công không dò được email nào tồn tại.
  if (!user || !passwordOk) throw new AppError('INVALID_CREDENTIALS');
  if (!user.isActive) throw new AppError('ACCOUNT_DISABLED'); // chỉ báo sau khi đã đúng mật khẩu
  return { user: toPublicUser(user), ...(await issueTokens(user)) };
}

/**
 * Đổi refresh token cũ lấy access token mới (và refresh token mới — "rotation":
 * mỗi refresh token chỉ dùng được MỘT lần; token cũ bị thu hồi).
 * @param {{ refreshToken?: string }} params
 * @returns {Promise<{ accessToken: string, refreshToken: string }>}
 * @throws {AppError} UNAUTHORIZED | ACCOUNT_DISABLED
 */
export async function refresh({ refreshToken }) {
  if (!refreshToken) throw new AppError('UNAUTHORIZED');
  const tokenHash = hashRefreshToken(refreshToken);

  // updateMany có điều kiện = "thu hồi nếu còn hiệu lực" trong MỘT câu lệnh nguyên tử:
  // hai request cùng lúc với cùng token thì chỉ một cái có count = 1.
  const revoked = await revokeIfValid({ tokenHash, now: new Date() });
  if (revoked !== 1) throw new AppError('UNAUTHORIZED');

  const record = await findToken(tokenHash);
  const user = await userService.getUserById(record.userId);
  if (!user.isActive) throw new AppError('ACCOUNT_DISABLED');
  return issueTokens(user);
}

/**
 * Đăng xuất: thu hồi refresh token đang dùng (nếu có).
 * @param {{ refreshToken?: string }} params
 * @returns {Promise<void>}
 */
export async function logout({ refreshToken }) {
  if (!refreshToken) return;
  await revokeToken({ tokenHash: hashRefreshToken(refreshToken), now: new Date() });
}

/**
 * Thông tin người dùng hiện tại. userId lấy từ token (không từ body).
 * @param {{ userId: string }} params
 * @returns {Promise<object>}
 * @throws {AppError} UNAUTHORIZED | ACCOUNT_DISABLED
 */
export async function getMe({ userId }) {
  return toPublicUser(await loadActiveUser(userId));
}

/** Lấy user đang đăng nhập và chắc chắn còn tồn tại / chưa bị khóa (requireAuth không hỏi DB). */
async function loadActiveUser(userId) {
  const user = await userService.getUserById(userId);
  if (!user) throw new AppError('UNAUTHORIZED');
  if (!user.isActive) throw new AppError('ACCOUNT_DISABLED');
  return user;
}

/**
 * Đổi mật khẩu. Yêu cầu mật khẩu hiện tại (người lỡ để quên máy mở / lấy được access token cũ cũng không đổi được).
 * Đổi xong THU HỒI MỌI refresh token của user (đăng xuất mọi thiết bị khác), rồi cấp một refresh token mới cho
 * thiết bị đang thao tác để người dùng không bị văng. Access token cũ vẫn dùng được tới khi hết hạn (tối đa 15 phút).
 * Sai mật khẩu hiện tại trả VALIDATION_ERROR (400), KHÔNG phải 401: client dùng 401 để hiểu là "hết phiên".
 * (Chuyển từ user.service sang auth.service vì phải thu hồi refresh token — thực thể của auth.)
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
  // Đổi mật khẩu + thu hồi mọi refresh token trong MỘT transaction: hoặc cả hai, hoặc không gì cả.
  await runInTransaction(async (tx) => {
    await userService.setPassword({ userId, passwordHash }, tx);
    await revokeAllOfUser({ userId, now: new Date() }, tx);
  });
  const { refreshToken } = await issueTokens(user);
  return { refreshToken };
}
