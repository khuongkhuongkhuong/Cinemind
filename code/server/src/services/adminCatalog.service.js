import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';

const fieldError = (field, message) => new AppError('VALIDATION_ERROR', { details: { fields: { [field]: message } } });
const notFound = (what) => new AppError('NOT_FOUND', { message: `Không tìm thấy ${what}.` });
const inUse = (message) => new AppError('RESOURCE_IN_USE', { message });

// ============================================================ THỂ LOẠI ============================================================

/** Danh sách thể loại kèm số phim đang gắn. @returns {Promise<Array<{ id: string, name: string, movieCount: number }>>} */
export async function listGenres() {
  const rows = await prisma.genre.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { movies: true } } } });
  return rows.map((g) => ({ id: g.id, name: g.name, movieCount: g._count.movies }));
}

/**
 * Tạo thể loại. Tên trùng -> VALIDATION_ERROR (hiện ngay ở ô nhập). UNIQUE(name) ở DB là trọng tài, không check-then-insert.
 * @param {{ name: string }} params
 */
export async function createGenre({ name }) {
  try {
    const g = await prisma.genre.create({ data: { name } });
    return { id: g.id, name: g.name, movieCount: 0 };
  } catch (err) {
    if (err.code === 'P2002') throw fieldError('name', 'Thể loại này đã tồn tại.');
    throw err;
  }
}

/** @param {{ genreId: string, name: string }} params @throws {AppError} NOT_FOUND | VALIDATION_ERROR */
export async function updateGenre({ genreId, name }) {
  try {
    const g = await prisma.genre.update({ where: { id: genreId }, data: { name }, include: { _count: { select: { movies: true } } } });
    return { id: g.id, name: g.name, movieCount: g._count.movies };
  } catch (err) {
    if (err.code === 'P2025') throw notFound('thể loại');
    if (err.code === 'P2002') throw fieldError('name', 'Thể loại này đã tồn tại.');
    throw err;
  }
}

/** Chỉ xóa thể loại chưa gắn phim nào (không âm thầm gỡ thể loại khỏi các phim). @throws {AppError} NOT_FOUND | RESOURCE_IN_USE */
export async function deleteGenre({ genreId }) {
  const g = await prisma.genre.findUnique({ where: { id: genreId }, include: { _count: { select: { movies: true } } } });
  if (!g) throw notFound('thể loại');
  if (g._count.movies > 0) throw inUse(`Thể loại đang gắn với ${g._count.movies} phim nên không xóa được.`);
  await prisma.genre.delete({ where: { id: genreId } });
}

// ============================================================== COMBO ==============================================================

const comboSelect = { id: true, name: true, description: true, price: true, imageUrl: true, isActive: true };

/** Mọi combo (kể cả đã ngừng bán) cho trang quản trị. */
export const listCombos = () => prisma.combo.findMany({ select: comboSelect, orderBy: [{ isActive: 'desc' }, { price: 'asc' }, { name: 'asc' }] });

/**
 * Tạo combo. Đổi giá sau này KHÔNG ảnh hưởng đơn đã tạo: giá được chốt vào OrderCombo (BR-14).
 * @param {{ name: string, description?: string|null, price: number, imageUrl?: string|null, isActive?: boolean }} data
 */
export const createCombo = (data) => prisma.combo.create({ data, select: comboSelect });

/** @param {{ comboId: string } & Partial<{ name: string, description: string|null, price: number, imageUrl: string|null, isActive: boolean }>} params */
export async function updateCombo({ comboId, ...changes }) {
  try {
    return await prisma.combo.update({ where: { id: comboId }, data: changes, select: comboSelect });
  } catch (err) {
    if (err.code === 'P2025') throw notFound('combo');
    throw err;
  }
}

/** Combo đã từng được bán thì KHÔNG xóa (giữ lịch sử); hãy chuyển sang ngừng bán (isActive = false). @throws {AppError} NOT_FOUND | RESOURCE_IN_USE */
export async function deleteCombo({ comboId }) {
  const combo = await prisma.combo.findUnique({ where: { id: comboId }, select: { id: true } });
  if (!combo) throw notFound('combo');
  if ((await prisma.orderCombo.count({ where: { comboId } })) > 0) {
    throw inUse('Combo đã có trong đơn hàng nên không xóa được. Hãy chuyển sang ngừng bán.');
  }
  await prisma.combo.delete({ where: { id: comboId } });
}
