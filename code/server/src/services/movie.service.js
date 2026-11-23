import { prisma } from '../config/prisma.js';

/**
 * Phim theo id (service phụ trách thực thể Movie).
 * @param {string} movieId
 * @param {object} [db]
 * @returns {Promise<object|null>} dòng Movie, hoặc `null` nếu không có (người gọi tự chọn lỗi NOT_FOUND phù hợp ngữ cảnh)
 */
export const getMovieById = (movieId, db = prisma) => db.movie.findUnique({ where: { id: movieId } });

/**
 * Phim có tồn tại không?
 * @param {string} movieId
 * @param {object} [db]
 * @returns {Promise<boolean>}
 */
export const movieExists = async (movieId, db = prisma) =>
  (await db.movie.findUnique({ where: { id: movieId }, select: { id: true } })) !== null;
