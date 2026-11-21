import { findActiveCombosByIds } from '../dao/combo.dao.js';

/**
 * Các combo ĐANG BÁN trong danh sách id: id không tồn tại hoặc đã ngừng bán thì không có trong kết quả
 * (người gọi so số lượng để báo lỗi). Dùng để lấy giá hiện tại khi khách chọn combo cho đơn.
 * @param {string[]} comboIds
 * @returns {Promise<Array<{ id: string, name: string, price: number }>>}
 */
export const getActiveCombos = (comboIds) => findActiveCombosByIds(comboIds);
