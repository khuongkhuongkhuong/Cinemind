import { prisma } from '../config/prisma.js';

/** Tăng số lượt đã dùng của mã khuyến mãi lên 1 (BR-24: chỉ trừ khi thanh toán thành công). Dùng `increment` nguyên tử của CSDL. */
export const incrementUsedCount = (promotionId, db = prisma) =>
  db.promotion.update({ where: { id: promotionId }, data: { usedCount: { increment: 1 } } });
