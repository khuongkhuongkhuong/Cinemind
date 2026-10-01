import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';

const fieldError = (field, message) => new AppError('VALIDATION_ERROR', { details: { fields: { [field]: message } } });
const notFound = () => new AppError('NOT_FOUND', { message: 'Không tìm thấy mã khuyến mãi.' });

/**
 * Kiểm tra các ràng buộc CHÉO giữa nhiều trường của một mã (dùng cho cả tạo mới lẫn sửa một phần, sau khi trộn dữ liệu cũ + mới).
 * - PERCENT: giá trị 1–100; FIXED: giá trị ≥ 1.
 * - `maxDiscount` (trần giảm) chỉ có nghĩa với PERCENT.
 * - Hết hạn phải sau ngày bắt đầu.
 * @throws {AppError} VALIDATION_ERROR
 */
export function assertPromotionShape(p) {
  if (p.discountType === 'PERCENT' && (p.discountValue < 1 || p.discountValue > 100)) throw fieldError('discountValue', 'Giảm theo % phải từ 1 đến 100.');
  if (p.discountType === 'FIXED' && p.discountValue < 1) throw fieldError('discountValue', 'Số tiền giảm phải lớn hơn 0.');
  if (p.maxDiscount != null && p.discountType !== 'PERCENT') throw fieldError('maxDiscount', 'Chỉ mã giảm theo % mới có mức giảm tối đa.');
  if (!(p.endAt > p.startAt)) throw fieldError('endAt', 'Ngày kết thúc phải sau ngày bắt đầu.');
}

/** Mọi mã khuyến mãi (kèm số lượt đã dùng), mới nhất trước. */
export const listPromotions = () => prisma.promotion.findMany({ orderBy: [{ startAt: 'desc' }, { code: 'asc' }] });

/**
 * Tạo mã khuyến mãi. `code` được viết hoa (người dùng nhập không phân biệt hoa-thường) và duy nhất — UNIQUE ở DB là trọng tài.
 * @param {object} data { code, name, description?, discountType, discountValue, maxDiscount?, minOrderValue?, startAt: Date, endAt: Date, usageLimit?, isActive? }
 * @throws {AppError} VALIDATION_ERROR
 */
export async function createPromotion(data) {
  const promo = { ...data, code: data.code.toUpperCase(), maxDiscount: data.maxDiscount ?? null, usageLimit: data.usageLimit ?? null };
  assertPromotionShape(promo);
  try {
    return await prisma.promotion.create({ data: promo });
  } catch (err) {
    if (err.code === 'P2002') throw fieldError('code', 'Mã này đã tồn tại.');
    throw err;
  }
}

/**
 * Sửa mã (từng phần). KHÔNG đổi được `code` và `usedCount` (đơn cũ đã dùng mã theo `code` đó; lượt dùng do hệ thống tính).
 * @param {{ promotionId: string } & object} params
 * @throws {AppError} NOT_FOUND | VALIDATION_ERROR
 */
export async function updatePromotion({ promotionId, ...changes }) {
  const current = await prisma.promotion.findUnique({ where: { id: promotionId } });
  if (!current) throw notFound();
  const merged = { ...current, ...changes };
  assertPromotionShape(merged);
  return prisma.promotion.update({ where: { id: promotionId }, data: changes });
}

/** Mã đã được gắn vào đơn nào thì KHÔNG xóa (giữ lịch sử); hãy tắt (isActive = false). @throws {AppError} NOT_FOUND | RESOURCE_IN_USE */
export async function deletePromotion({ promotionId }) {
  const promo = await prisma.promotion.findUnique({ where: { id: promotionId }, select: { id: true } });
  if (!promo) throw notFound();
  if ((await prisma.order.count({ where: { promotionId } })) > 0) {
    throw new AppError('RESOURCE_IN_USE', { message: 'Mã đã được dùng trong đơn hàng nên không xóa được. Hãy tắt mã.' });
  }
  await prisma.promotion.delete({ where: { id: promotionId } });
}
