import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { hashPassword } from '../lib/password.js';
import { buildMeta, toSkipTake } from '../utils/pagination.js';

const userSelect = { id: true, email: true, fullName: true, phone: true, role: true, points: true, isActive: true, createdAt: true };
const forbidden = (message) => new AppError('FORBIDDEN', { message });

/**
 * Danh sách tài khoản cho trang quản trị: lọc theo vai trò, tìm theo email / họ tên (không phân biệt hoa-thường).
 * @param {{ q?: string, role?: 'USER'|'STAFF'|'ADMIN', page: number, pageSize: number }} params
 */
export async function listUsers({ q, role, page, pageSize }) {
  const keyword = q?.trim();
  const where = {
    ...(role && { role }),
    ...(keyword && {
      OR: [
        { email: { contains: keyword, mode: 'insensitive' } },
        { fullName: { contains: keyword, mode: 'insensitive' } },
      ],
    }),
  };
  const [total, items] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, ...toSkipTake({ page, pageSize }), select: userSelect }),
  ]);
  return { items, meta: buildMeta({ page, pageSize }, total) };
}

/**
 * Tạo tài khoản NHÂN VIÊN (vai trò STAFF). API này không tạo được ADMIN: nâng quyền là thao tác riêng, có kiểm soát.
 * @param {{ email: string, password: string, fullName: string, phone?: string }} params
 * @returns {Promise<object>} user (không có mật khẩu)
 * @throws {AppError} EMAIL_EXISTS
 */
export async function createStaff({ email, password, fullName, phone }) {
  const passwordHash = await hashPassword(password);
  try {
    // Ghi thẳng, để UNIQUE(email) quyết định (không check-then-insert).
    return await prisma.user.create({ data: { email, passwordHash, fullName, phone: phone ?? null, role: 'STAFF' }, select: userSelect });
  } catch (err) {
    if (err.code === 'P2002') throw new AppError('EMAIL_EXISTS');
    throw err;
  }
}

/**
 * Phần ruột của việc đổi vai trò / khóa tài khoản, chạy trong transaction `tx` (tách riêng để test được).
 * Luật:
 *  1. Admin không tự khóa / tự đổi vai trò của chính mình.
 *  2. Luôn còn ÍT NHẤT MỘT admin đang hoạt động: không khóa / hạ quyền người admin cuối cùng.
 * Khóa tài khoản còn thu hồi mọi refresh token của họ.
 * @param {object} tx
 * @param {{ actorId: string, userId: string, role?: string, isActive?: boolean }} params
 * @throws {AppError} NOT_FOUND | FORBIDDEN
 */
export async function applyUserUpdate(tx, { actorId, userId, role, isActive }) {
  const target = await tx.user.findUnique({ where: { id: userId } });
  if (!target) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy tài khoản.' });

  const roleChanges = role !== undefined && role !== target.role;
  const locks = isActive === false && target.isActive;
  if (actorId === userId && (roleChanges || locks)) throw forbidden('Admin không thể tự khóa hoặc tự đổi vai trò của chính mình.');

  const stopsBeingActiveAdmin = target.role === 'ADMIN' && target.isActive && (roleChanges || locks);
  if (stopsBeingActiveAdmin) {
    const others = await tx.user.count({ where: { role: 'ADMIN', isActive: true, id: { not: userId } } });
    if (others === 0) throw forbidden('Hệ thống phải còn ít nhất một quản trị viên đang hoạt động.');
  }

  const updated = await tx.user.update({
    where: { id: userId },
    data: { ...(role !== undefined && { role }), ...(isActive !== undefined && { isActive }) },
    select: userSelect,
  });
  if (locks) await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  return updated;
}

/**
 * Đổi vai trò và/hoặc khóa-mở tài khoản. Mọi thay đổi admin đi qua MỘT khóa tư vấn toàn cục để "luôn còn một admin"
 * đúng cả khi hai admin cùng lúc hạ quyền lẫn nhau (nếu không, cả hai cùng thấy "còn người kia" rồi cùng hạ => 0 admin).
 * Hiệu lực ngay trên /admin và /staff (requireFreshRole đọc lại DB); route khách hàng thường chậm tối đa 15 phút (hạn access token).
 * @param {{ actorId: string, userId: string, role?: string, isActive?: boolean }} params actorId lấy từ token
 * @returns {Promise<object>} user sau khi cập nhật
 * @throws {AppError} NOT_FOUND | FORBIDDEN
 */
export function updateUser(params) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('admin-users'))`;
    return applyUserUpdate(tx, params);
  }, { maxWait: 10_000, timeout: 15_000 });
}
