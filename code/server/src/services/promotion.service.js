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
 * Kiểm tra một mã còn dùng được không (BR-22) và trả về mã. Hàm thuần: không đụng CSDL; lượt dùng chỉ bị trừ khi thanh toán (BR-24).
 * Số lần tài khoản đã dùng mã do `order.service` đếm (bảng Order thuộc về nó) rồi truyền vào `usedByUser`.
 * @param {{ promotion: object|null, subtotal: number, usedByUser: number, now?: Date }} params
 *   `usedByUser`: số đơn ĐÃ THANH TOÁN (kể cả chờ hoàn tiền) của tài khoản này đã dùng mã, không tính đơn đang áp mã.
 * @returns {object} promotion
 * @throws {AppError} PROMO_INVALID với details.reason ∈ NOT_FOUND | NOT_STARTED | EXPIRED | USAGE_LIMIT_REACHED | MIN_ORDER_NOT_MET | ALREADY_USED
 */
export function assertPromotionUsable({ promotion, subtotal, usedByUser, now = new Date() }) {
  if (!promotion || !promotion.isActive) throw promoError('NOT_FOUND');
  if (now < promotion.startAt) throw promoError('NOT_STARTED');
  if (now > promotion.endAt) throw promoError('EXPIRED');
  if (promotion.usageLimit != null && promotion.usedCount >= promotion.usageLimit) throw promoError('USAGE_LIMIT_REACHED');
  if (subtotal < promotion.minOrderValue) throw promoError('MIN_ORDER_NOT_MET');
  if (usedByUser > 0) throw promoError('ALREADY_USED'); // mỗi tài khoản dùng 1 lần
  return promotion;
}

/**
 * Tìm mã theo chuỗi người dùng nhập (không phân biệt hoa/thường, bỏ khoảng trắng).
 * @param {{ code: string, db?: object }} params `db` là prisma hoặc `tx` trong transaction
 * @returns {Promise<object|null>} Promotion hoặc null
 */
export const findPromotionByCode = ({ code, db = prisma }) =>
  db.promotion.findUnique({ where: { code: code.trim().toUpperCase() } });

/**
 * Ghi nhận một lượt dùng mã khi đơn thanh toán thành công (BR-24): tăng `usedCount` nguyên tử bằng `increment` của CSDL.
 * Gọi trong transaction của order (truyền `tx`).
 * @param {string} promotionId
 * @param {object} [db]
 * @returns {Promise<object>} Promotion sau khi cập nhật
 */
export const recordUsage = (promotionId, db = prisma) =>
  db.promotion.update({ where: { id: promotionId }, data: { usedCount: { increment: 1 } } });
