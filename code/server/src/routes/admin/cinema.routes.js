import { Router } from 'express';
import * as ctrl from '../../controllers/admin/cinema.controller.js';
import { validate } from '../../middlewares/validate.js';
import { createCinemaSchema, updateCinemaSchema } from '../../validators/admin.cinema.schema.js';
import { z } from 'zod';

const idParam = z.object({ id: z.uuid('id không hợp lệ') });

// Rạp: liệt kê / tạo / sửa (không xóa — dùng "tắt"). Phòng + sơ đồ ghế: chỉ xem (nạp bằng seed).
export const cinemaRoutes = Router();
cinemaRoutes.get('/', ctrl.list);
cinemaRoutes.post('/', validate(createCinemaSchema), ctrl.create);
cinemaRoutes.put('/:id', validate(idParam, 'params'), validate(updateCinemaSchema), ctrl.update);

export const roomRoutes = Router();
roomRoutes.get('/:id/seats', validate(idParam, 'params'), ctrl.roomSeats);
