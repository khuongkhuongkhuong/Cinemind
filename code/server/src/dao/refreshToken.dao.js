import { prisma } from '../config/prisma.js';

/** Lưu refresh token (chỉ bản BĂM, không bao giờ lưu token gốc). */
export const insertRefreshToken = ({ userId, tokenHash, expiresAt }, db = prisma) =>
  db.refreshToken.create({ data: { userId, tokenHash, expiresAt } });

/**
 * ⭐ Thu hồi token NẾU còn hiệu lực (chưa thu hồi, chưa hết hạn) trong MỘT câu cập nhật có điều kiện:
 * hai request cùng lúc với cùng token thì chỉ một cái có count = 1 (mỗi refresh token dùng được đúng một lần).
 * @returns {Promise<number>} 1 nếu vừa thu hồi được, 0 nếu token không hợp lệ / đã bị dùng
 */
export const revokeIfValid = async ({ tokenHash, now }, db = prisma) =>
  (await db.refreshToken.updateMany({ where: { tokenHash, revokedAt: null, expiresAt: { gt: now } }, data: { revokedAt: now } })).count;

/** @returns {Promise<(object & { user: object })|null>} bản ghi token kèm user */
export const findTokenWithUser = (tokenHash, db = prisma) => db.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });

/** Thu hồi một token (đăng xuất). Không có / đã thu hồi thì không làm gì. @returns {Promise<number>} số dòng đã thu hồi */
export const revokeToken = async ({ tokenHash, now }, db = prisma) =>
  (await db.refreshToken.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: now } })).count;

/** Thu hồi MỌI token còn hiệu lực của một user (đăng xuất mọi thiết bị). @returns {Promise<number>} */
export const revokeAllOfUser = async ({ userId, now }, db = prisma) =>
  (await db.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } })).count;
