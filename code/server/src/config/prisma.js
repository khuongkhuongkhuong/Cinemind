import { PrismaClient } from '@prisma/client';

// Một PrismaClient dùng chung cho cả app (mỗi client giữ một pool kết nối tới DB).
export const prisma = new PrismaClient();

/**
 * Chạy `work(tx)` trong MỘT transaction: mọi bước dùng cùng `tx`; ném lỗi thì ROLLBACK toàn bộ.
 * Service mở transaction qua hàm này thay vì gọi `prisma.$transaction` trực tiếp.
 * @template T
 * @param {(tx: import('@prisma/client').Prisma.TransactionClient) => Promise<T>} work
 * @param {{ maxWait?: number, timeout?: number, isolationLevel?: string }} [options]
 * @returns {Promise<T>}
 */
export const runInTransaction = (work, options) => prisma.$transaction(work, options);
