import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { removeAccents } from '../lib/text.js';
import { buildMeta, toSkipTake } from '../utils/pagination.js';

const genreSelect = { genres: { select: { genre: { select: { id: true, name: true } } } } };

/** Date (kiểu @db.Date) -> "YYYY-MM-DD" như hợp đồng API. */
const dateOnly = (d) => d.toISOString().slice(0, 10);

/** Dòng Prisma -> MovieSummary (04-api-contract mục 3.0). */
function toSummary(m) {
  return {
    id: m.id,
    title: m.title,
    slug: m.slug,
    posterUrl: m.posterUrl,
    durationMin: m.durationMin,
    ageRating: m.ageRating,
    status: m.status,
    releaseDate: dateOnly(m.releaseDate),
    genres: m.genres.map((g) => g.genre),
  };
}

/**
 * Danh sách phim (lọc, tìm kiếm không dấu, phân trang).
 * @param {{ status?: string, q?: string, genreId?: string, page: number, pageSize: number }} params
 * @returns {Promise<{ items: object[], meta: object }>}
 */
export async function listMovies({ status, q, genreId, page, pageSize }) {
  const where = {
    ...(status && { status }),
    ...(genreId && { genres: { some: { genreId } } }),
    // searchKey đã là tên không dấu chữ thường -> chuẩn hóa từ khóa rồi tìm chuỗi con
    ...(q && { searchKey: { contains: removeAccents(q.trim()) } }),
  };
  const [total, rows] = await Promise.all([
    prisma.movie.count({ where }),
    prisma.movie.findMany({
      where,
      orderBy: [{ releaseDate: 'desc' }, { title: 'asc' }], // title: thứ tự ổn định khi trùng ngày
      ...toSkipTake({ page, pageSize }),
      include: genreSelect,
    }),
  ]);
  return { items: rows.map(toSummary), meta: buildMeta({ page, pageSize }, total) };
}

/**
 * Chi tiết phim theo slug.
 * @param {{ slug: string }} params
 * @returns {Promise<object>} MovieDetail
 * @throws {AppError} NOT_FOUND
 */
export async function getMovieBySlug({ slug }) {
  const m = await prisma.movie.findUnique({ where: { slug }, include: genreSelect });
  if (!m) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy phim.' });
  return {
    ...toSummary(m),
    description: m.description,
    director: m.director,
    actors: m.actors,
    language: m.language,
    trailerUrl: m.trailerUrl,
  };
}

/** @returns {Promise<Array<{ id: string, name: string }>>} */
export const listGenres = () => prisma.genre.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });

/** @returns {Promise<Array<{ id: string, name: string }>>} */
export const listCities = () => prisma.city.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });

/**
 * Rạp đang hoạt động, có thể lọc theo thành phố.
 * @param {{ cityId?: string }} params
 * @returns {Promise<Array<{ id: string, name: string, address: string, cityId: string }>>}
 */
export function listCinemas({ cityId } = {}) {
  return prisma.cinema.findMany({
    where: { isActive: true, ...(cityId && { cityId }) },
    select: { id: true, name: true, address: true, cityId: true },
    orderBy: { name: 'asc' },
  });
}

/** @returns {Promise<Array<{ id: string, name: string, description: string|null, price: number, imageUrl: string|null }>>} */
export const listCombos = () =>
  prisma.combo.findMany({
    where: { isActive: true },
    select: { id: true, name: true, description: true, price: true, imageUrl: true },
    orderBy: { price: 'asc' },
  });

/** Banner đang hoạt động và nằm trong khung thời gian hiển thị (nếu có). */
export function listBanners() {
  const now = new Date();
  return prisma.banner.findMany({
    where: {
      isActive: true,
      AND: [
        { OR: [{ startAt: null }, { startAt: { lte: now } }] },
        { OR: [{ endAt: null }, { endAt: { gte: now } }] },
      ],
    },
    select: { id: true, title: true, imageUrl: true, linkUrl: true },
    orderBy: { sortOrder: 'asc' },
  });
}
