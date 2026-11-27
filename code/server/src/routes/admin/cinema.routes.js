import { Router } from 'express';
import * as ctrl from '../../controllers/admin/cinema.controller.js';
import { validate } from '../../middlewares/validate.js';
import { createCinemaSchema, createRoomSchema, updateCinemaSchema, updateRoomSchema } from '../../validators/admin.cinema.schema.js';
import { z } from 'zod';

const idParam = z.object({ id: z.uuid('id không hợp lệ') });

// Rạp: liệt kê / tạo / sửa (không xóa — dùng "tắt"). Phòng: thêm / sửa / ngưng / xóa nếu chưa từng có suất; sơ đồ ghế chỉ xem.
export const cinemaRoutes = Router();
cinemaRoutes.get('/', ctrl.list);
cinemaRoutes.post('/', validate(createCinemaSchema), ctrl.create);
cinemaRoutes.put('/:id', validate(idParam, 'params'), validate(updateCinemaSchema), ctrl.update);
cinemaRoutes.post('/:id/rooms', validate(idParam, 'params'), validate(createRoomSchema), ctrl.createRoom);

export const roomRoutes = Router();
roomRoutes.get('/:id/seats', validate(idParam, 'params'), ctrl.roomSeats);
roomRoutes.put('/:id', validate(idParam, 'params'), validate(updateRoomSchema), ctrl.updateRoom);
roomRoutes.delete('/:id', validate(idParam, 'params'), ctrl.deleteRoom);
