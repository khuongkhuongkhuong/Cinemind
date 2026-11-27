import { z } from 'zod';
import { paginationShape } from '../utils/pagination.js';

const formatEnum = z.enum(['F2D', 'F3D', 'IMAX']);
const audioEnum = z.enum(['SUBTITLE', 'DUBBED']);
// Chuỗi ISO 8601 có múi giờ (vd 2026-10-05T11:30:00.000Z) -> Date
const startTime = z.iso.datetime({ message: 'startTime phải là thời điểm ISO 8601 (ví dụ 2026-10-05T11:30:00.000Z)' }).transform((s) => new Date(s));
const basePrice = z.number().int('Giá phải là số nguyên').min(0).max(5_000_000);

export const adminShowtimesQuery = z.object({
  cinemaId: z.uuid('cinemaId không hợp lệ').optional(),
  roomId: z.uuid('roomId không hợp lệ').optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có dạng YYYY-MM-DD').optional(),
  ...paginationShape,
});

export const createShowtimeSchema = z.object({
  movieId: z.uuid('movieId không hợp lệ'),
  roomId: z.uuid('roomId không hợp lệ'),
  startTime,
  format: formatEnum,
  audio: audioEnum,
  basePrice: basePrice.optional(),
});

const vnDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có dạng YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().startsWith(s), 'Ngày không tồn tại');
const vnTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Giờ phải có dạng HH:mm');

export const bulkShowtimeSchema = z.object({
  movieId: z.uuid('movieId không hợp lệ'),
  roomId: z.uuid('roomId không hợp lệ'),
  dates: z.array(vnDate).min(1, 'Chọn ít nhất một ngày').max(31, 'Tối đa 31 ngày'),
  times: z.array(vnTime).min(1, 'Nhập ít nhất một giờ chiếu').max(12, 'Tối đa 12 giờ chiếu'),
  format: formatEnum,
  audio: audioEnum,
  basePrice: basePrice.optional(),
  dryRun: z.boolean().optional(),
}).strict();

export const updateShowtimeSchema = z.object({
  movieId: z.uuid().optional(),
  roomId: z.uuid().optional(),
  startTime: startTime.optional(),
  format: formatEnum.optional(),
  audio: audioEnum.optional(),
  basePrice: basePrice.optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'Cần ít nhất một trường để sửa.' });

export const showtimeIdParam = z.object({ id: z.uuid('id không hợp lệ') });
