import { z } from 'zod';
import { paginationShape } from '../utils/pagination.js';

export const auditLogsQuery = z.object({
  actorId: z.uuid('actorId không hợp lệ').optional(),
  entityType: z.string().trim().min(1).max(50).optional(),
  ...paginationShape,
});
