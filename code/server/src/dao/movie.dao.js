import { prisma } from '../config/prisma.js';

/** @returns {Promise<object|null>} Movie */
export const getMovieById = (movieId, db = prisma) => db.movie.findUnique({ where: { id: movieId } });

/** Chỉ để biết phim có tồn tại không. @returns {Promise<{ id: string }|null>} */
export const getMovieIdById = (movieId, db = prisma) => db.movie.findUnique({ where: { id: movieId }, select: { id: true } });
