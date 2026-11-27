import { prisma, runInTransaction } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import {
  REFRESH_TTL_MS, signAccessToken, generateRefreshToken, hashRefreshToken,
} from '../lib/jwt.js';
import * as userService from './user.service.js';
import * as emailCodeService from './emailCode.service.js';
import { sendMail } from '../lib/mailer.js';

// Hash giả để so sánh khi email không tồn tại -> thời gian phản hồi giống nhau, không lộ email nào đã đăng ký.
const DUMMY_HASH = await hashPassword('mat-khau-gia-khong-ai-dung');

/** Chỉ trả các trường an toàn — tuyệt đối không có passwordHash. */
const toPublicUser = (u) => ({
  id: u.id, email: u.email, fullName: u.fullName, phone: u.phone, role: u.role, points: u.points,
  emailVerified: Boolean(u.emailVerifiedAt),
});

const MAILS = {
  VERIFY_EMAIL: { subject: 'Mã xác minh email Cinemind', intro: 'Mã xác minh email của bạn là' },
  RESET_PASSWORD: { subject: 'Mã đặt lại mật khẩu Cinemind', intro: 'Mã đặt lại mật khẩu của bạn là' },
};

/** Gửi mã qua email. Lỗi gửi thư chỉ ghi log (không kèm mã): người dùng bấm "Gửi lại mã" được. */
function deliverCode({ email, purpose, code }) {
  const { subject, intro } = MAILS[purpose];
  const text = `${intro}: ${code}\nMã hết hạn sau 10 phút. Nếu bạn không yêu cầu, hãy bỏ qua thư này.`;
  return sendMail({ to: email, subject, text }).catch((err) => console.error('[mail] không gửi được:', err.message));
}

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
    const user = await userService.createUser({ email, passwordHash, fullName, phone: phone ?? null, emailVerifiedAt: null }); // BR-40
    const issued = await emailCodeService.issueCode({ userId: user.id, purpose: 'VERIFY_EMAIL' });
    if (issued.issued) deliverCode({ email: user.email, purpose: 'VERIFY_EMAIL', code: issued.code }); // không chờ: gửi thư chậm không làm đăng ký chậm
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

/**
 * Xác minh email bằng mã 6 số (BR-40, BR-41). Đã xác minh rồi thì trả luôn user.
 * @param {{ userId: string, code: string }} params userId lấy từ token
 * @returns {Promise<object>} user công khai
 * @throws {AppError} UNAUTHORIZED | ACCOUNT_DISABLED | CODE_INVALID (details.attemptsLeft)
 */
export async function verifyEmail({ userId, code }) {
  const user = await loadActiveUser(userId);
  if (user.emailVerifiedAt) return toPublicUser(user);
  const result = await emailCodeService.consumeCode({ userId, purpose: 'VERIFY_EMAIL', code });
  if (!result.ok) {
    const message = result.attemptsLeft > 0 ? `Mã không đúng. Bạn còn ${result.attemptsLeft} lần nhập.` : 'Mã đã hết hạn hoặc nhập sai quá nhiều lần. Hãy bấm "Gửi lại mã".';
    throw new AppError('CODE_INVALID', { message, details: { attemptsLeft: result.attemptsLeft } });
  }
  await userService.markEmailVerified({ userId });
  return toPublicUser(await loadActiveUser(userId));
}

/**
 * Gửi lại mã xác minh.
 * @param {{ userId: string }} params
 * @returns {Promise<{ alreadyVerified: boolean }>}
 * @throws {AppError} UNAUTHORIZED | ACCOUNT_DISABLED | RATE_LIMITED (details.retryAfterSec)
 */
export async function resendVerificationCode({ userId }) {
  const user = await loadActiveUser(userId);
  if (user.emailVerifiedAt) return { alreadyVerified: true };
  const issued = await emailCodeService.issueCode({ userId, purpose: 'VERIFY_EMAIL' });
  if (!issued.issued) {
    throw new AppError('RATE_LIMITED', { message: `Vui lòng đợi ${issued.retryAfterSec} giây rồi xin mã mới.`, details: { retryAfterSec: issued.retryAfterSec } });
  }
  deliverCode({ email: user.email, purpose: 'VERIFY_EMAIL', code: issued.code });
  return { alreadyVerified: false };
}

/**
 * Quên mật khẩu: gửi mã đặt lại NẾU tài khoản tồn tại và đang hoạt động. ⭐ Người gọi không biết được điều đó (BR-42):
 * hàm trả về ngay, việc tra cứu và gửi thư chạy sau, nên phản hồi và thời gian trả lời giống nhau cho mọi email.
 * @param {{ email: string }} params
 * @returns {{ done: Promise<void> }} `done` chỉ để test chờ; controller không dùng
 */
export function requestPasswordReset({ email }) {
  const done = (async () => {
    const user = await userService.findUserByEmail(email);
    if (!user || !user.isActive) return;
    const issued = await emailCodeService.issueCode({ userId: user.id, purpose: 'RESET_PASSWORD' });
    if (issued.issued) await deliverCode({ email: user.email, purpose: 'RESET_PASSWORD', code: issued.code });
  })().catch((err) => console.error('[auth] không xử lý được yêu cầu quên mật khẩu:', err.message));
  return { done };
}

/**
 * Đặt mật khẩu mới bằng mã đã gửi qua email. Thành công: thu hồi MỌI phiên đăng nhập và coi email đã xác minh (người đặt lại
 * đã chứng minh đọc được hộp thư). Mọi nguyên nhân thất bại trả CÙNG một lỗi (không lộ email nào tồn tại).
 * @param {{ email: string, code: string, newPassword: string }} params
 * @throws {AppError} CODE_INVALID
 */
export async function resetPassword({ email, code, newPassword }) {
  const invalid = () => new AppError('CODE_INVALID', { message: 'Mã không đúng hoặc đã hết hạn. Hãy kiểm tra lại hoặc xin mã mới.' });
  const user = await userService.findUserByEmail(email);
  if (!user || !user.isActive) throw invalid();
  const result = await emailCodeService.consumeCode({ userId: user.id, purpose: 'RESET_PASSWORD', code });
  if (!result.ok) throw invalid();
  const passwordHash = await hashPassword(newPassword);
  await runInTransaction(async (tx) => {
    await userService.setPassword({ userId: user.id, passwordHash }, tx);
    await userService.markEmailVerified({ userId: user.id }, tx);
    await emailCodeService.discardCode({ userId: user.id, purpose: 'VERIFY_EMAIL' }, tx);
    await revokeAllOfUser({ userId: user.id, now: new Date() }, tx);
  });
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

// =============================================================================================
// TRUY VẤN NỘI BỘ (@internal) — bảng RefreshToken. Mỗi hàm MỘT thao tác đọc / ghi; chỉ file này gọi chúng (docs/04 v1.26).
// Tham số cuối `db = prisma`: truyền `tx` khi chạy trong transaction. Lỗi CSDL (vd P2002) đi xuyên ra cho hàm nghiệp vụ xử lý.
// =============================================================================================

/**
 * Lưu refresh token (chỉ bản BĂM, không bao giờ lưu token gốc).
 * @internal
 */
export const insertRefreshToken = ({ userId, tokenHash, expiresAt }, db = prisma) =>
  db.refreshToken.create({ data: { userId, tokenHash, expiresAt } });

/**
 * ⭐ Thu hồi token NẾU còn hiệu lực (chưa thu hồi, chưa hết hạn) trong MỘT câu cập nhật có điều kiện:
 * hai request cùng lúc với cùng token thì chỉ một cái có count = 1 (mỗi refresh token dùng được đúng một lần).
 * @internal
 * @returns {Promise<number>} 1 nếu vừa thu hồi được, 0 nếu token không hợp lệ / đã bị dùng
 */
export const revokeIfValid = async ({ tokenHash, now }, db = prisma) =>
  (await db.refreshToken.updateMany({ where: { tokenHash, revokedAt: null, expiresAt: { gt: now } }, data: { revokedAt: now } })).count;

/**
 * @returns {Promise<object|null>} bản ghi RefreshToken (không kèm user: user thuộc `user.service`)
 * @internal
 */
export const findToken = (tokenHash, db = prisma) => db.refreshToken.findUnique({ where: { tokenHash } });

/**
 * Thu hồi một token (đăng xuất). Không có / đã thu hồi thì không làm gì. @returns {Promise<number>} số dòng đã thu hồi
 * @internal
 */
export const revokeToken = async ({ tokenHash, now }, db = prisma) =>
  (await db.refreshToken.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: now } })).count;

/**
 * Thu hồi MỌI token còn hiệu lực của một user (đăng xuất mọi thiết bị). @returns {Promise<number>}
 * @internal
 */
export const revokeAllOfUser = async ({ userId, now }, db = prisma) =>
  (await db.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } })).count;
