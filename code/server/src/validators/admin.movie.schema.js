import { z } from 'zod';
import { paginationShape } from '../utils/pagination.js';

// Chỉ http/https: chặn "javascript:..." / "data:..." chui vào ảnh/trailer rồi bị hiển thị cho khách (XSS).
const httpUrl = z.url({ protocol: /^https?$/, message: 'URL phải bắt đầu bằng http:// hoặc https://' }).max(500);
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có dạng YYYY-MM-DD').refine((s) => !Number.isNaN(Date.parse(s)), 'Ngày không hợp lệ');
const ageRating = z.enum(['P', 'K', 'T13', 'T16', 'T18']);
const status = z.enum(['COMING_SOON', 'NOW_SHOWING', 'ENDED']);

const fields = {
  title: z.string().trim().min(1, 'Vui lòng nhập tên phim').max(200),
  description: z.string().trim().min(1, 'Vui lòng nhập mô tả').max(5000),
  durationMin: z.number().int().min(1).max(600),
  ageRating,
  status,
  releaseDate: dateOnly,
  director: z.string().trim().max(200).nullable(),
  actors: z.string().trim().max(500).nullable(),
  language: z.string().trim().max(100).nullable(),
  posterUrl: httpUrl.nullable(),
  trailerUrl: httpUrl.nullable(),
  genreIds: z.array(z.uuid('genreId không hợp lệ')).max(10),
};

export const createMovieSchema = z.object({
  title: fields.title,
  description: fields.description,
  durationMin: fields.durationMin,
  ageRating: fields.ageRating,
  releaseDate: fields.releaseDate,
  status: fields.status.optional(),
  director: fields.director.optional(),
  actors: fields.actors.optional(),
  language: fields.language.optional(),
  posterUrl: fields.posterUrl.optional(),
  trailerUrl: fields.trailerUrl.optional(),
  genreIds: fields.genreIds.optional(),
}).strict();

// Sửa một phần: gửi trường nào thì đổi trường đó.
export const updateMovieSchema = z.object(
  Object.fromEntries(Object.entries(fields).filter(([k]) => k !== 'status').map(([k, v]) => [k, v.optional()])),
).strict().refine((v) => Object.keys(v).length > 0, { message: 'Cần ít nhất một trường để sửa.' });

export const movieStatusSchema = z.object({ status }).strict();
export const movieIdParam = z.object({ id: z.uuid('id không hợp lệ') });

export const adminMoviesQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: status.optional(),
  ...paginationShape,
});
