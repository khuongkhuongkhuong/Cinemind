import { prisma } from '../config/prisma.js';

// Tầng DAO (docs/04 mục 5.2): chỉ truy vấn, không luật nghiệp vụ, không AppError. Các hàm ở đây là phần dùng chung
// cho transaction; service mở transaction qua đây thay vì gọi prisma.$transaction trực tiếp.

/**
 * Chạy `work(tx)` trong MỘT transaction: mọi bước dùng cùng `tx`; ném lỗi thì ROLLBACK toàn bộ.
 * @template T
 * @param {(tx: import('@prisma/client').Prisma.TransactionClient) => Promise<T>} work
 * @param {{ maxWait?: number, timeout?: number, isolationLevel?: string }} [options]
 * @returns {Promise<T>}
 */
export const runInTransaction = (work, options) => prisma.$transaction(work, options);

/**
 * Khóa tư vấn (advisory lock) theo phòng, tự nhả khi transaction kết thúc. Xếp hàng các thao tác thêm / sửa / hủy suất chiếu
 * trong cùng một phòng để "kiểm tra trùng giờ rồi mới ghi" không bị race.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} roomId
 */
export const lockRoom = (tx, roomId) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${roomId}))`;
