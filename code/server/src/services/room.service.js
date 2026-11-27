import { prisma, runInTransaction } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { findCinemaById } from './catalog.service.js';
import * as seatService from './seat.service.js';
import * as showtimeService from './showtime.service.js';

// Service phụ trách thực thể Room. Ghế thuộc seat.service, suất chiếu thuộc showtime.service.

const notFound = () => new AppError('NOT_FOUND', { message: 'Không tìm thấy phòng chiếu.' });
const toRoom = (room, seatCount) => ({ id: room.id, name: room.name, isActive: room.isActive, seatCount });

/** UNIQUE (cinemaId, name) là trọng tài chống trùng tên: không kiểm tra trước rồi mới ghi. */
function asNameError(err) {
  if (err?.code !== 'P2002') return err;
  return new AppError('VALIDATION_ERROR', { details: { fields: { name: 'Rạp đã có phòng tên này.' } } });
}

/**
 * Phòng chiếu theo id.
 * @param {string} roomId
 * @param {object} [db]
 * @returns {Promise<object|null>} dòng Room, hoặc `null` nếu không có (người gọi tự kiểm tra `isActive` và chọn lỗi)
 */
export const getRoomById = (roomId, db = prisma) => db.room.findUnique({ where: { id: roomId } });

/**
 * Thêm phòng vào rạp, kèm sơ đồ ghế theo mẫu — tất cả trong một transaction.
 * @param {{ cinemaId: string, name: string, template: 'SMALL'|'MEDIUM'|'LARGE' }} params
 * @returns {Promise<{ id: string, name: string, isActive: boolean, seatCount: number }>}
 * @throws {AppError} NOT_FOUND | VALIDATION_ERROR (trùng tên)
 */
export async function createRoom({ cinemaId, name, template }) {
  if (!(await findCinemaById(cinemaId))) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy rạp.' });
  try {
    return await runInTransaction(async (tx) => {
      const room = await insertRoom({ cinemaId, name }, tx);
      const seatCount = await seatService.createSeatsForRoom({ roomId: room.id, template }, tx);
      return toRoom(room, seatCount);
    });
  } catch (err) {
    throw asNameError(err);
  }
}

/**
 * Đổi tên, ngưng hoặc mở lại phòng. Không ngưng được khi còn suất sắp chiếu đã có người mua / giữ vé.
 * Suất của phòng ngưng được giữ nguyên nhưng đóng bán và ẩn khỏi lịch của khách.
 * @param {{ roomId: string, name?: string, isActive?: boolean }} params
 * @returns {Promise<{ id: string, name: string, isActive: boolean, seatCount: number }>}
 * @throws {AppError} NOT_FOUND | VALIDATION_ERROR | RESOURCE_IN_USE
 */
export async function updateRoom({ roomId, name, isActive }) {
  const current = await getRoomById(roomId);
  if (!current) throw notFound();
  try {
    return await showtimeService.withRoomLock(roomId, async (tx) => {
      if (isActive === false && current.isActive && (await showtimeService.roomHasUpcomingSales({ roomId }, tx))) {
        throw new AppError('RESOURCE_IN_USE', { message: 'Phòng còn suất sắp chiếu đã có người đặt vé. Hãy hủy / hoàn tiền các đơn đó trước khi ngưng phòng.' });
      }
      const room = await updateRoomById(roomId, { name, isActive }, tx);
      return toRoom(room, await seatService.countSeatsOfRoom(roomId, tx));
    });
  } catch (err) {
    throw asNameError(err);
  }
}

/**
 * Xóa phòng tạo nhầm: chỉ khi CHƯA TỪNG có suất chiếu (để không mất lịch sử vé / doanh thu).
 * @param {{ roomId: string }} params
 * @throws {AppError} NOT_FOUND | RESOURCE_IN_USE
 */
export async function deleteRoom({ roomId }) {
  if (!(await getRoomById(roomId))) throw notFound();
  const inUse = () => new AppError('RESOURCE_IN_USE', { message: 'Phòng đã có suất chiếu nên không xóa được. Hãy ngưng phòng thay vì xóa.' });
  try {
    await showtimeService.withRoomLock(roomId, async (tx) => {
      if (await showtimeService.roomHasShowtimes({ roomId }, tx)) throw inUse();
      await seatService.removeSeatsOfRoom(roomId, tx);
      await deleteRoomById(roomId, tx);
    });
  } catch (err) {
    if (err?.code === 'P2003') throw inUse(); // khóa ngoại chặn nếu suất chen vào đúng lúc xóa
    throw err;
  }
}

// =============================================================================================
// TRUY VẤN NỘI BỘ (@internal) — bảng Room.
// =============================================================================================

/** @internal */
export const insertRoom = ({ cinemaId, name }, db = prisma) => db.room.create({ data: { cinemaId, name } });

/** Chỉ đổi các trường khác `undefined`. @internal */
export const updateRoomById = (roomId, data, db = prisma) => db.room.update({ where: { id: roomId }, data });

/** @internal */
export const deleteRoomById = (roomId, db = prisma) => db.room.delete({ where: { id: roomId } });
