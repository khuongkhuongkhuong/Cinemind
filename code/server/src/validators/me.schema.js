import { z } from 'zod';
import { paginationShape } from '../utils/pagination.js';

export const myOrdersQuery = z.object({
  status: z.enum(['PENDING', 'PAID', 'CANCELLED', 'EXPIRED', 'REFUND_PENDING', 'REFUNDED']).optional(),
  ...paginationShape,
});

export const codeParam = z.object({ code: z.string().trim().min(4).max(20) });
