import { z } from 'zod';
import { paginationShape } from '../utils/pagination.js';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có dạng YYYY-MM-DD');

export const adminOrdersQuery = z.object({
  status: z.enum(['PENDING', 'PAID', 'CANCELLED', 'EXPIRED', 'REFUND_PENDING', 'REFUNDED']).optional(),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  q: z.string().trim().max(50).optional(),
  ...paginationShape,
});

export const adminOrderIdParam = z.object({ id: z.uuid('id không hợp lệ') });
