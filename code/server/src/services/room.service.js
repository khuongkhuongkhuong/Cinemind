import { getRoomById as findRoom } from '../dao/room.dao.js';

/**
 * Phòng chiếu theo id (service phụ trách thực thể Room).
 * @param {string} roomId
 * @returns {Promise<object|null>} dòng Room, hoặc `null` nếu không có (người gọi tự kiểm tra `isActive` và chọn lỗi)
 */
export const getRoomById = (roomId) => findRoom(roomId);
