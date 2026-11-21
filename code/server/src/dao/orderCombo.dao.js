import { prisma } from '../config/prisma.js';

/**
 * Xóa mọi dòng combo của đơn (trước khi ghi lại cả danh sách).
 * @returns {Promise<{ count: number } >}
 */
export const deleteCombosOfOrder = (orderId, db = prisma) => db.orderCombo.deleteMany({ where: { orderId } });

/**
 * Ghi các dòng combo của đơn với GIÁ ĐÃ CHỐT (BR-14).
 * @param {{ orderId: string, items: Array<{ comboId: string, quantity: number, unitPrice: number }> }} params
 * @returns {Promise<{ count: number } >}
 */
export const insertOrderCombos = ({ orderId, items }, db = prisma) =>
  db.orderCombo.createMany({ data: items.map((i) => ({ orderId, comboId: i.comboId, quantity: i.quantity, unitPrice: i.unitPrice })) });
