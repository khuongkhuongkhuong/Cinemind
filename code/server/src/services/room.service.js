import { prisma } from '../config/prisma.js';

/**
 * Phòng chiếu theo id (service phụ trách thực thể Room).
 * @param {string} roomId
 * @param {object} [db]
 * @returns {Promise<object|null>} dòng Room, hoặc `null` nếu không có (người gọi tự kiểm tra `isActive` và chọn lỗi)
 */
export const getRoomById = (roomId, db = prisma) => db.room.findUnique({ where: { id: roomId } });
