import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';

const bannerSelect = { id: true, title: true, imageUrl: true, linkUrl: true, sortOrder: true, isActive: true, startAt: true, endAt: true };
const notFound = () => new AppError('NOT_FOUND', { message: 'Không tìm thấy banner.' });

/** Ràng buộc chéo: nếu có cả hai mốc thì kết thúc phải sau bắt đầu. @throws {AppError} VALIDATION_ERROR */
function assertWindow({ startAt, endAt }) {
  if (startAt && endAt && !(endAt > startAt)) {
    throw new AppError('VALIDATION_ERROR', { details: { fields: { endAt: 'Ngày kết thúc phải sau ngày bắt đầu.' } } });
  }
}

/** Mọi banner (kể cả đang tắt / hết hạn) cho trang quản trị, theo thứ tự hiển thị. */
export const listBanners = () => prisma.banner.findMany({ select: bannerSelect, orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }] });

/** @param {{ title: string, imageUrl: string, linkUrl?: string|null, sortOrder?: number, isActive?: boolean, startAt?: Date|null, endAt?: Date|null }} data */
export async function createBanner(data) {
  assertWindow(data);
  return prisma.banner.create({ data, select: bannerSelect });
}

/** Sửa từng phần; mốc thời gian được kiểm tra trên dữ liệu SAU KHI trộn với bản cũ. @throws {AppError} NOT_FOUND | VALIDATION_ERROR */
export async function updateBanner({ bannerId, ...changes }) {
  const current = await prisma.banner.findUnique({ where: { id: bannerId } });
  if (!current) throw notFound();
  assertWindow({ ...current, ...changes });
  return prisma.banner.update({ where: { id: bannerId }, data: changes, select: bannerSelect });
}

/** Banner không được tham chiếu bởi bảng nào nên xóa thẳng. @throws {AppError} NOT_FOUND */
export async function deleteBanner({ bannerId }) {
  try {
    await prisma.banner.delete({ where: { id: bannerId } });
  } catch (err) {
    if (err.code === 'P2025') throw notFound();
    throw err;
  }
}
