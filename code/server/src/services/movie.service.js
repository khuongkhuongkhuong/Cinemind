import { getMovieById as findMovie, getMovieIdById } from '../dao/movie.dao.js';

/**
 * Phim theo id (service phụ trách thực thể Movie).
 * @param {string} movieId
 * @returns {Promise<object|null>} dòng Movie, hoặc `null` nếu không có (người gọi tự chọn lỗi NOT_FOUND phù hợp ngữ cảnh)
 */
export const getMovieById = (movieId) => findMovie(movieId);

/**
 * Phim có tồn tại không?
 * @param {string} movieId
 * @returns {Promise<boolean>}
 */
export const movieExists = async (movieId) => (await getMovieIdById(movieId)) !== null;
