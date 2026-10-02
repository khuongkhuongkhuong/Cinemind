import { z } from 'zod';

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có dạng YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Ngày không hợp lệ');

export const movieShowtimesQuery = z.object({
  date: dateOnly,
  cityId: z.uuid('cityId không hợp lệ'),
});

export const idParam = z.object({ id: z.uuid('id không hợp lệ') });
export const movieIdParam = z.object({ movieId: z.uuid('movieId không hợp lệ') });
export const cinemaIdParam = z.object({ cinemaId: z.uuid('cinemaId không hợp lệ') });
export const cinemaShowtimesQuery = z.object({ date: dateOnly });
