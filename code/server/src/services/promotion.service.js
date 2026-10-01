import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';

const promoError = (reason) => new AppError('PROMO_INVALID', { details: { reason } });

/**
 * Số tiền giảm của một mã trên tổng tiền (hàm thuần). BR-21, BR-23 (áp trên tổng vé + combo).
 * - PERCENT: subtotal × % (làm tròn xuống), không vượt `maxDiscount` nếu có.
 * - FIXED: số tiền cố định.
 * Không bao giờ giảm quá tổng tiền (đơn không âm).
 * @param {{ discountType: 'PERCENT'|'FIXED', discountValue: number, maxDiscount: number|null }} promotion
 * @param {number} subtotal tổng vé + combo trước giảm giá
 * @returns {number}
 */
export function calcDiscount(promotion, subtotal) {
  let discount = promotion.discountType === 'PERCENT'
    ? Math.floor((subtotal * promotion.discountValue) / 100)
    : promotion.discountValue;
  if (promotion.discountType === 'PERCENT' && promotion.maxDiscount != null) {
    discount = Math.min(discount, promotion.maxDiscount);
  }
  return Math.max(0, Math.min(discount, subtotal));
}

/**
 * Kiểm tra một mã còn dùng được không (BR-22) và trả về mã. Chỉ ĐỌC; lượt dùng chỉ bị trừ khi thanh toán (BR-24).
 * @param {{ promotion: object|null, userId: string, subtotal: number, orderId?: string, now?: Date, db?: object }} params
 *   `db` là prisma hoặc `tx` trong transaction; `orderId` để bỏ qua chính đơn đang áp mã khi đếm "đã dùng".
 * @returns {Promise<object>} promotion
 * @throws {AppError} PROMO_INVALID với details.reason ∈ NOT_FOUND | NOT_STARTED | EXPIRED | USAGE_LIMIT_REACHED | MIN_ORDER_NOT_MET | ALREADY_USED
 */
export async function assertPromotionUsable({ promotion, userId, subtotal, orderId, now = new Date(), db = prisma }) {
  if (!promotion || !promotion.isActive) throw promoError('NOT_FOUND');
  if (now < promotion.startAt) throw promoError('NOT_STARTED');
  if (now > promotion.endAt) throw promoError('EXPIRED');
  if (promotion.usageLimit != null && promotion.usedCount >= promotion.usageLimit) throw promoError('USAGE_LIMIT_REACHED');
  if (subtotal < promotion.minOrderValue) throw promoError('MIN_ORDER_NOT_MET');

  // Mỗi tài khoản dùng 1 lần: đã có đơn ĐÃ THANH TOÁN dùng mã này (REFUND_PENDING cũng là đã thu tiền).
  const used = await db.order.count({
    where: {
      userId, promotionId: promotion.id, status: { in: ['PAID', 'REFUND_PENDING'] },
      ...(orderId && { id: { not: orderId } }),
    },
  });
  if (used > 0) throw promoError('ALREADY_USED');
  return promotion;
}

/** Tìm mã theo chuỗi người dùng nhập (không phân biệt hoa/thường, bỏ khoảng trắng). */
export const findPromotionByCode = ({ code, db = prisma }) =>
  db.promotion.findUnique({ where: { code: code.trim().toUpperCase() } });
