import { prisma } from '../config/prisma.js';

/** Các combo ĐANG BÁN trong danh sách id (id không tồn tại / đã ngừng bán thì không có trong kết quả). */
export const findActiveCombosByIds = (comboIds, db = prisma) => db.combo.findMany({ where: { id: { in: comboIds }, isActive: true } });
