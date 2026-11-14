import { prisma } from '../config/prisma.js';

/** @returns {Promise<object|null>} User (kèm passwordHash — service chịu trách nhiệm không trả ra ngoài) */
export const findUserByEmail = (email, db = prisma) => db.user.findUnique({ where: { email } });

/** @returns {Promise<object|null>} User hoặc null */
export const findUserById = (userId, db = prisma) => db.user.findUnique({ where: { id: userId } });

/** Chỉ vai trò + trạng thái hoạt động (cho middleware đọc lại quyền mỗi request). @returns {Promise<{ role: string, isActive: boolean }|null>} */
export const findUserRoleState = (userId, db = prisma) =>
  db.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true } });

/**
 * Tạo user. Trùng email -> lỗi Prisma P2002 đi xuyên qua DAO (UNIQUE(email) là trọng tài); service dịch sang EMAIL_EXISTS.
 * @param {{ email: string, passwordHash: string, fullName: string, phone: string|null }} data
 */
export const insertUser = (data, db = prisma) => db.user.create({ data });

/** Cập nhật một phần các trường của user (service quyết định trường nào được phép). */
export const updateUserById = (userId, data, db = prisma) => db.user.update({ where: { id: userId }, data });

export const setPasswordHash = (userId, passwordHash, db = prisma) => db.user.update({ where: { id: userId }, data: { passwordHash } });

/** Cộng điểm thưởng (BR-25) bằng `increment` nguyên tử của CSDL. */
export const addPoints = (userId, points, db = prisma) => db.user.update({ where: { id: userId }, data: { points: { increment: points } } });
