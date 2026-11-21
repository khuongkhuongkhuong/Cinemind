import { prisma } from '../config/prisma.js';

/** Phim + phòng + rạp của suất (cho ShowtimeDetail). */
export const SHOWTIME_INCLUDE = {
  movie: { select: { id: true, title: true, ageRating: true, posterUrl: true } },
  room: { select: { id: true, name: true, cinema: { select: { id: true, name: true } } } },
};

/** Các trường suất cho trang quản trị. */
export const ADMIN_SELECT = {
  id: true, startTime: true, endTime: true, format: true, audio: true, basePrice: true, status: true,
  movie: { select: { id: true, title: true } },
  room: { select: { id: true, name: true, cinema: { select: { id: true, name: true } } } },
};

/** @returns {Promise<object|null>} suất kèm phim + phòng + rạp */
export const getShowtimeDetail = (showtimeId, db = prisma) => db.showtime.findUnique({ where: { id: showtimeId }, include: SHOWTIME_INCLUDE });

/**
 * Suất kèm bản ghi phim (cho sửa suất).
 * @returns {Promise<object|null>} Showtime kèm movie
 */
export const getShowtimeWithMovie = (showtimeId, db = prisma) => db.showtime.findUnique({ where: { id: showtimeId }, include: { movie: true } });

/** Chỉ phòng + trạng thái (cho hủy suất). @returns {Promise<{ roomId: string, status: string }|null>} */
export const getShowtimeRoomAndStatus = (showtimeId, db = prisma) =>
  db.showtime.findUnique({ where: { id: showtimeId }, select: { roomId: true, status: true } });

/**
 * Suất theo `ADMIN_SELECT`.
 * @returns {Promise<object|null>} Showtime kèm phim, phòng, rạp
 */
export const getAdminShowtime = (showtimeId, db = prisma) => db.showtime.findUnique({ where: { id: showtimeId }, select: ADMIN_SELECT });

/**
 * Các suất OPEN của MỘT PHIM trong khoảng [from, to) ở các rạp đang hoạt động của một thành phố, sắp theo giờ.
 * @returns {Promise<object[]>} Showtime
 */
export const listOpenShowtimesOfMovie = ({ movieId, from, to, cityId }, db = prisma) =>
  db.showtime.findMany({
    where: {
      movieId,
      status: 'OPEN',
      startTime: { gte: from, lt: to },
      room: { cinema: { cityId, isActive: true } },
    },
    orderBy: { startTime: 'asc' },
    select: {
      id: true, startTime: true, format: true, audio: true, status: true,
      room: { select: { cinema: { select: { id: true, name: true, address: true } } } },
    },
  });

/**
 * Các suất OPEN của MỘT RẠP trong khoảng [from, to), kèm phim, sắp theo giờ.
 * @returns {Promise<object[]>} Showtime
 */
export const listOpenShowtimesOfCinema = ({ cinemaId, from, to }, db = prisma) =>
  db.showtime.findMany({
    where: { status: 'OPEN', startTime: { gte: from, lt: to }, room: { cinemaId } },
    orderBy: { startTime: 'asc' },
    select: {
      id: true, startTime: true, format: true, audio: true, status: true,
      movie: { select: { id: true, title: true, slug: true, ageRating: true, posterUrl: true, durationMin: true } },
    },
  });

/**
 * Tìm các suất OPEN trong khoảng [from, to) theo nhiều điều kiện tùy chọn, dạng dữ liệu phẳng (cho trợ lý AI).
 * @param {{ from: Date, to: Date, movieId?: string, format?: string, cinemaId?: string, cityIds?: string[] }} filter
 * @returns {Promise<object[]>} Showtime
 */
export const searchOpenShowtimes = ({ from, to, movieId, format, cinemaId, cityIds }, db = prisma) =>
  db.showtime.findMany({
    where: {
      status: 'OPEN',
      startTime: { gte: from, lt: to },
      ...(movieId && { movieId }),
      ...(format && { format }),
      room: { isActive: true, cinema: { isActive: true, ...(cinemaId && { id: cinemaId }), ...(cityIds && { cityId: { in: cityIds } }) } },
    },
    orderBy: { startTime: 'asc' },
    select: {
      id: true, startTime: true, format: true, audio: true, basePrice: true, status: true, roomId: true,
      movie: { select: { id: true, title: true } },
      room: { select: { cinema: { select: { id: true, name: true } } } },
    },
  });

/** Điều kiện lọc của trang quản trị: phòng, rạp, khoảng thời gian [from, to). */
const adminWhere = ({ roomId, cinemaId, from, to }) => ({
  ...(roomId && { roomId }),
  ...(cinemaId && { room: { cinemaId } }),
  ...(from && { startTime: { gte: from, lt: to } }),
});

/** @returns {Promise<number>} */
export const countAdminShowtimes = (filter, db = prisma) => db.showtime.count({ where: adminWhere(filter) });

/**
 * @param {{ roomId?: string, cinemaId?: string, from?: Date, to?: Date }} filter @param {{ skip: number, take: number }} page
 * @returns {Promise<object[]>} một trang Showtime
 */
export const findAdminShowtimes = (filter, { skip, take }, db = prisma) =>
  db.showtime.findMany({ where: adminWhere(filter), orderBy: { startTime: 'asc' }, skip, take, select: ADMIN_SELECT });

/**
 * Có suất khác (chưa hủy) trong CÙNG PHÒNG chồng lấn thời gian không? Hai khoảng [s1,e1) và [s2,e2) chồng nhau khi
 * s1 < e2 VÀ e1 > s2; hai suất nối đuôi KHÔNG tính là trùng. Chạy trong transaction ĐÃ KHÓA phòng (dao/transaction.lockRoom).
 * @returns {Promise<{ id: string }|null>} suất đang xung đột (nếu có)
 */
export const findOverlapInRoom = ({ roomId, startTime, endTime, excludeId }, db = prisma) =>
  db.showtime.findFirst({
    where: {
      roomId, status: 'OPEN', startTime: { lt: endTime }, endTime: { gt: startTime },
      ...(excludeId && { id: { not: excludeId } }),
    },
    select: { id: true },
  });

/** Thêm suất. @returns {Promise<object>} theo `ADMIN_SELECT` */
export const insertShowtime = ({ movieId, roomId, startTime, endTime, format, audio, basePrice }, db = prisma) =>
  db.showtime.create({ data: { movieId, roomId, startTime, endTime, format, audio, basePrice }, select: ADMIN_SELECT });

/** Cập nhật suất (service quyết định trường nào đổi). @returns {Promise<object>} theo `ADMIN_SELECT` */
export const updateShowtimeById = (showtimeId, data, db = prisma) =>
  db.showtime.update({ where: { id: showtimeId }, data, select: ADMIN_SELECT });

/** @returns {Promise<object|null>} Showtime thô (không kèm quan hệ) */
export const getShowtimeById = (showtimeId, db = prisma) => db.showtime.findUnique({ where: { id: showtimeId } });
