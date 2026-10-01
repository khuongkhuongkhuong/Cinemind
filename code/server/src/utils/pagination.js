import { z } from 'zod';

// ?page=1&pageSize=20 — mặc định 1 / 20, tối đa 100 (04-api-contract mục 1).
export const paginationShape = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};

/** Tham số cho Prisma: { skip, take }. */
export const toSkipTake = ({ page, pageSize }) => ({ skip: (page - 1) * pageSize, take: pageSize });

/** Khối `meta` của response danh sách. */
export const buildMeta = ({ page, pageSize }, total) => ({
  page, pageSize, total, totalPages: Math.ceil(total / pageSize),
});
