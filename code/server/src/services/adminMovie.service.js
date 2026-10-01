import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { removeAccents, slugify } from '../lib/text.js';
import { buildMeta, toSkipTake } from '../utils/pagination.js';
import { genreSelect, toDetail, toSummary } from './catalog.service.js';

const fieldError = (field, message) => new AppError('VALIDATION_ERROR', { details: { fields: { [field]: message } } });

/** Phim có suất chiếu SẮP TỚI còn mở bán không? (dùng chặn đổi thời lượng / ngừng chiếu) */
const hasUpcomingShowtimes = async (db, movieId) =>
  (await db.showtime.count({ where: { movieId, status: 'OPEN', startTime: { gt: new Date() } } })) > 0;

async function assertGenresExist(db, genreIds) {
  if (!genreIds?.length) return;
  const found = await db.genre.count({ where: { id: { in: genreIds } } });
  if (found !== new Set(genreIds).size) throw fieldError('genreIds', 'Có thể loại không tồn tại.');
}

async function loadDetail(db, movieId) {
  const m = await db.movie.findUnique({ where: { id: movieId }, include: genreSelect });
  if (!m) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy phim.' });
  return toDetail(m);
}

/**
 * Danh sách phim cho trang quản trị: MỌI trạng thái (kể cả ENDED), tìm không dấu theo tên.
 * @param {{ q?: string, status?: string, page: number, pageSize: number }} params
 */
export async function listAdminMovies({ q, status, page, pageSize }) {
  const where = {
    ...(status && { status }),
    ...(q?.trim() && { searchKey: { contains: removeAccents(q.trim()) } }),
  };
  const [total, rows] = await Promise.all([
    prisma.movie.count({ where }),
    prisma.movie.findMany({
      where, orderBy: [{ createdAt: 'desc' }, { title: 'asc' }], ...toSkipTake({ page, pageSize }), include: genreSelect,
    }),
  ]);
  return { items: rows.map(toSummary), meta: buildMeta({ page, pageSize }, total) };
}

/** Chi tiết một phim theo id (admin xem cả phim ENDED). @throws {AppError} NOT_FOUND */
export const getAdminMovie = ({ movieId }) => loadDetail(prisma, movieId);

/**
 * Tạo phim. `slug` sinh từ tên; trùng thì thêm hậu tố -2, -3... (UNIQUE ở DB là trọng tài, không check-then-insert).
 * @param {object} data { title, description, durationMin, ageRating, status?, releaseDate (YYYY-MM-DD), director?, actors?,
 *   language?, posterUrl?, trailerUrl?, genreIds? }
 * @returns {Promise<object>} MovieDetail
 * @throws {AppError} VALIDATION_ERROR (thể loại không tồn tại)
 */
export async function createMovie({ genreIds = [], releaseDate, ...data }) {
  await assertGenresExist(prisma, genreIds);
  const base = slugify(data.title) || 'phim';
  for (let attempt = 1; attempt <= 20; attempt++) {
    const slug = attempt === 1 ? base : `${base}-${attempt}`;
    try {
      const created = await prisma.movie.create({
        data: {
          ...data, slug, searchKey: removeAccents(data.title), releaseDate: new Date(releaseDate),
          genres: { create: [...new Set(genreIds)].map((genreId) => ({ genreId })) },
        },
      });
      return loadDetail(prisma, created.id);
    } catch (err) {
      if (err.code !== 'P2002') throw err; // trùng slug -> thử hậu tố kế tiếp
    }
  }
  throw new AppError('INTERNAL_ERROR');
}

/**
 * Sửa phim (chỉ các trường được gửi). `slug` GIỮ NGUYÊN khi đổi tên để không gãy đường dẫn đã chia sẻ.
 * Có `genreIds` thì THAY CẢ DANH SÁCH thể loại. Không đổi thời lượng khi phim còn suất chiếu sắp tới
 * (giờ kết thúc của các suất đã tính từ thời lượng cũ).
 * @throws {AppError} NOT_FOUND | VALIDATION_ERROR | RESOURCE_IN_USE
 */
export async function updateMovie({ movieId, genreIds, releaseDate, ...changes }) {
  const current = await prisma.movie.findUnique({ where: { id: movieId } });
  if (!current) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy phim.' });
  await assertGenresExist(prisma, genreIds);

  if (changes.durationMin !== undefined && changes.durationMin !== current.durationMin && await hasUpcomingShowtimes(prisma, movieId)) {
    throw new AppError('RESOURCE_IN_USE', { message: 'Phim còn suất chiếu sắp tới nên không đổi được thời lượng. Hãy hủy các suất đó trước.' });
  }

  await prisma.$transaction(async (tx) => {
    await tx.movie.update({
      where: { id: movieId },
      data: {
        ...changes,
        ...(changes.title !== undefined && { searchKey: removeAccents(changes.title) }),
        ...(releaseDate !== undefined && { releaseDate: new Date(releaseDate) }),
      },
    });
    if (genreIds) {
      await tx.movieGenre.deleteMany({ where: { movieId } });
      await tx.movieGenre.createMany({ data: [...new Set(genreIds)].map((genreId) => ({ movieId, genreId })) });
    }
  });
  return loadDetail(prisma, movieId);
}

/**
 * Đổi trạng thái phim (COMING_SOON / NOW_SHOWING / ENDED). Ngừng chiếu (ENDED) khi còn suất sắp tới thì từ chối:
 * nếu không phim đã "ngừng chiếu" vẫn bán vé. Hủy các suất đó trước (xử lý đơn nếu đã có người mua).
 * @param {{ movieId: string, status: 'COMING_SOON'|'NOW_SHOWING'|'ENDED' }} params
 * @throws {AppError} NOT_FOUND | RESOURCE_IN_USE
 */
export async function setMovieStatus({ movieId, status }) {
  const current = await prisma.movie.findUnique({ where: { id: movieId }, select: { id: true } });
  if (!current) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy phim.' });
  if (status === 'ENDED' && await hasUpcomingShowtimes(prisma, movieId)) {
    throw new AppError('RESOURCE_IN_USE', { message: 'Phim còn suất chiếu sắp tới. Hãy hủy các suất đó trước khi ngừng chiếu.' });
  }
  await prisma.movie.update({ where: { id: movieId }, data: { status } });
  return loadDetail(prisma, movieId);
}

/**
 * Xóa hẳn phim. Phim đã từng có suất chiếu (kể cả đã qua / đã hủy) thì KHÔNG xóa được để giữ lịch sử đơn hàng;
 * dùng "Ngừng chiếu" thay thế.
 * @throws {AppError} NOT_FOUND | RESOURCE_IN_USE
 */
export async function deleteMovie({ movieId }) {
  const current = await prisma.movie.findUnique({ where: { id: movieId }, select: { id: true } });
  if (!current) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy phim.' });
  const showtimes = await prisma.showtime.count({ where: { movieId } });
  if (showtimes > 0) {
    throw new AppError('RESOURCE_IN_USE', { message: 'Phim đã có lịch chiếu nên không xóa được. Hãy chuyển sang "Ngừng chiếu".' });
  }
  await prisma.movie.delete({ where: { id: movieId } }); // MovieGenre xóa theo (cascade)
}
