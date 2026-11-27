import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';

/** Chỉ các trường an toàn — tuyệt đối không có passwordHash. */
const publicUser = (u) => ({ id: u.id, email: u.email, fullName: u.fullName, phone: u.phone, role: u.role, points: u.points, emailVerified: Boolean(u.emailVerifiedAt) });

/** Lấy user đang đăng nhập và chắc chắn còn tồn tại / chưa bị khóa (requireAuth không hỏi DB). */
async function loadActiveUser(userId) {
  const user = await getUserById(userId);
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
 * Người dùng theo email (đăng nhập).
 * @param {string} email
 * @param {object} [db]
 * @returns {Promise<object|null>} dòng User (có passwordHash — chỉ dùng nội bộ để kiểm mật khẩu, không trả ra ngoài), hoặc null
 */
export const findUserByEmail = (email, db = prisma) => db.user.findUnique({ where: { email } });

/**
 * Người dùng theo id.
 * @param {string} userId
 * @param {object} [db]
 * @returns {Promise<object|null>} dòng User hoặc null
 */
export const getUserById = (userId, db = prisma) => db.user.findUnique({ where: { id: userId } });

/**
 * Tạo người dùng mới. Không kiểm tra trùng email trước: UNIQUE(email) là trọng tài, lỗi Prisma P2002 đi xuyên ra ngoài
 * để người gọi (auth.register) dịch sang EMAIL_EXISTS.
 * @param {{ email: string, passwordHash: string, fullName: string, phone: string|null, emailVerifiedAt?: Date|null }} data
 *   Không gửi `emailVerifiedAt` = coi như đã xác minh (mặc định của cột); đăng ký công khai PHẢI gửi `null`.
 * @param {object} [db]
 * @returns {Promise<object>} User vừa tạo
 */
export const createUser = (data, db = prisma) => db.user.create({ data });

/**
 * Ghi mật khẩu đã băm mới. Gọi trong transaction của auth (đổi mật khẩu kèm thu hồi refresh token).
 * @param {{ userId: string, passwordHash: string }} params
 * @param {object} [db]
 * @returns {Promise<object>} User sau khi cập nhật
 */
export const setPassword = ({ userId, passwordHash }, db = prisma) => db.user.update({ where: { id: userId }, data: { passwordHash } });

/**
 * Đánh dấu email đã xác minh (đã xác minh rồi thì giữ nguyên thời điểm cũ).
 * @param {{ userId: string, now?: Date }} params
 * @param {object} [db]
 */
export const markEmailVerified = ({ userId, now = new Date() }, db = prisma) =>
  db.user.updateMany({ where: { id: userId, emailVerifiedAt: null }, data: { emailVerifiedAt: now } });

/**
 * Chặn thao tác đặt vé khi chưa xác minh email (BR-40). order.service và kênh trợ lý AI gọi.
 * @param {{ userId: string }} params
 * @param {object} [db]
 * @throws {AppError} UNAUTHORIZED | EMAIL_NOT_VERIFIED
 */
export async function assertEmailVerified({ userId }, db) {
  const user = await getUserById(userId, db);
  if (!user) throw new AppError('UNAUTHORIZED');
  if (!user.emailVerifiedAt) throw new AppError('EMAIL_NOT_VERIFIED');
}

/**
 * Cộng điểm thưởng (BR-25) bằng `increment` nguyên tử của CSDL. Gọi trong transaction thanh toán (truyền `tx`).
 * @param {{ userId: string, points: number }} params
 * @param {object} [db]
 * @returns {Promise<object>} User sau khi cập nhật
 */
export const addPoints = ({ userId, points }, db = prisma) =>
  db.user.update({ where: { id: userId }, data: { points: { increment: points } } });

/**
 * Vai trò và trạng thái HIỆN TẠI của tài khoản trong DB (không tin vai trò ghi trong access token).
 * @param {{ userId: string }} params
 * @param {object} [db]
 * @returns {Promise<{ role: string, isActive: boolean } | null>} null nếu tài khoản không còn tồn tại
 */
export const getAccountState = ({ userId }, db = prisma) =>
  db.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true } });
