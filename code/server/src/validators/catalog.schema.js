import { z } from 'zod';
import { paginationShape } from '../utils/pagination.js';

export const listMoviesQuery = z.object({
  status: z.enum(['NOW_SHOWING', 'COMING_SOON', 'ENDED']).optional(),
  q: z.string().trim().max(100).optional(),
  genreId: z.uuid('genreId không hợp lệ').optional(),
  ...paginationShape,
});

export const listCinemasQuery = z.object({
  cityId: z.uuid('cityId không hợp lệ').optional(),
});
