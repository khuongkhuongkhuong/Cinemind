import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { removeAccents } from '../lib/text.js';
import { buildMeta, toSkipTake } from '../utils/pagination.js';

export const genreSelect = { genres: { select: { genre: { select: { id: true, name: true } } } } };

/** Date (kiểu @db.Date) -> "YYYY-MM-DD" như hợp đồng API. */
const dateOnly = (d) => d.toISOString().slice(0, 10);

/** Dòng Prisma -> MovieSummary (04-api-contract mục 3.0). */
export function toSummary(m) {
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

/** Dòng Prisma -> MovieDetail = MovieSummary + các trường mô tả (04-api-contract mục 3.0). */
export function toDetail(m) {
  return {
    ...toSummary(m),
    description: m.description,
    director: m.director,
    actors: m.actors,
    language: m.language,
    trailerUrl: m.trailerUrl,
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
  return toDetail(m);
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

// =============================================================================================
// DÀNH CHO TRỢ LÝ AI (docs/07): tìm theo TÊN (không dấu), trả dữ liệu phẳng, dễ đọc cho LLM.
// =============================================================================================

const norm = (s) => removeAccents(String(s ?? '').trim()).toLowerCase();

/**
 * Tìm các thành phố có tên khớp (không dấu, không phân biệt hoa thường, chứa chuỗi con). "ha noi" -> Hà Nội.
 * @param {string} cityName
 * @returns {Promise<Array<{ id: string, name: string }>>}
 */
export async function findCitiesByName(cityName) {
  const key = norm(cityName);
  if (!key) return [];
  const cities = await prisma.city.findMany({ select: { id: true, name: true } });
  return cities.filter((c) => norm(c.name).includes(key));
}

/**
 * Tìm phim theo tên / thể loại / trạng thái, kết quả phẳng cho LLM.
 * @param {{ query?: string, status?: 'NOW_SHOWING'|'COMING_SOON'|'ENDED', genre?: string, limit?: number }} params
 *   `genre` là TÊN thể loại (không dấu cũng được); `limit` mặc định 10, tối đa 20.
 * @returns {Promise<Array<{ id: string, title: string, slug: string, ageRating: string, durationMin: number, status: string, releaseDate: string, genres: string[] }>>}
 */
export async function searchMovies({ query, status, genre, limit = 10 } = {}) {
  let genreIds;
  if (genre) {
    const genres = await prisma.genre.findMany({ select: { id: true, name: true } });
    genreIds = genres.filter((g) => norm(g.name).includes(norm(genre))).map((g) => g.id);
    if (genreIds.length === 0) return [];
  }
  const rows = await prisma.movie.findMany({
    where: {
      ...(status && { status }),
      ...(genreIds && { genres: { some: { genreId: { in: genreIds } } } }),
      ...(query && { searchKey: { contains: removeAccents(query.trim()) } }),
    },
    orderBy: [{ releaseDate: 'desc' }, { title: 'asc' }],
    take: Math.min(Math.max(1, limit), 20),
    include: genreSelect,
  });
  return rows.map((m) => {
    const s = toSummary(m);
    return { id: s.id, title: s.title, slug: s.slug, ageRating: s.ageRating, durationMin: s.durationMin, status: s.status, releaseDate: s.releaseDate, genres: s.genres.map((g) => g.name) };
  });
}

/**
 * Chi tiết phim theo id (cho trợ lý AI; web dùng slug).
 * @param {{ movieId: string }} params
 * @returns {Promise<object>} MovieDetail
 * @throws {AppError} NOT_FOUND
 */
export async function getMovieById({ movieId }) {
  const m = await prisma.movie.findUnique({ where: { id: movieId }, include: genreSelect });
  if (!m) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy phim.' });
  return toDetail(m);
}

/**
 * Rạp đang hoạt động theo TÊN thành phố (không dấu cũng được). Không có thành phố nào khớp -> [].
 * @param {{ cityName: string }} params
 * @returns {Promise<Array<{ id: string, name: string, address: string, cityId: string, cityName: string }>>}
 */
export async function listCinemasByCityName({ cityName }) {
  const cities = await findCitiesByName(cityName);
  if (cities.length === 0) return [];
  const rows = await prisma.cinema.findMany({
    where: { isActive: true, cityId: { in: cities.map((c) => c.id) } },
    select: { id: true, name: true, address: true, cityId: true },
    orderBy: { name: 'asc' },
  });
  const cityOf = new Map(cities.map((c) => [c.id, c.name]));
  return rows.map((r) => ({ ...r, cityName: cityOf.get(r.cityId) }));
}
