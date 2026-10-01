import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import {
  REFRESH_TTL_MS, signAccessToken, generateRefreshToken, hashRefreshToken,
} from '../lib/jwt.js';

// Hash giả để so sánh khi email không tồn tại -> thời gian phản hồi giống nhau, không lộ email nào đã đăng ký.
const DUMMY_HASH = await hashPassword('mat-khau-gia-khong-ai-dung');

/** Chỉ trả các trường an toàn — tuyệt đối không có passwordHash. */
const toPublicUser = (u) => ({
  id: u.id, email: u.email, fullName: u.fullName, phone: u.phone, role: u.role, points: u.points,
});

async function issueTokens(user) {
  const refreshToken = generateRefreshToken();
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    },
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
    const user = await prisma.user.create({
      data: { email, passwordHash, fullName, phone: phone ?? null },
    });
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
  const user = await prisma.user.findUnique({ where: { email } });
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
  const revoked = await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { revokedAt: new Date() },
  });
  if (revoked.count !== 1) throw new AppError('UNAUTHORIZED');

  const record = await prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });
  if (!record.user.isActive) throw new AppError('ACCOUNT_DISABLED');
  return issueTokens(record.user);
}

/**
 * Đăng xuất: thu hồi refresh token đang dùng (nếu có).
 * @param {{ refreshToken?: string }} params
 * @returns {Promise<void>}
 */
export async function logout({ refreshToken }) {
  if (!refreshToken) return;
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashRefreshToken(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Thông tin người dùng hiện tại. userId lấy từ token (không từ body).
 * @param {{ userId: string }} params
 * @returns {Promise<object>}
 * @throws {AppError} UNAUTHORIZED | ACCOUNT_DISABLED
 */
export async function getMe({ userId }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('UNAUTHORIZED');
  if (!user.isActive) throw new AppError('ACCOUNT_DISABLED');
  return toPublicUser(user);
}
