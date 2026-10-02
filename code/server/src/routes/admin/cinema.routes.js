import { Router } from 'express';
import * as ctrl from '../../controllers/admin/cinema.controller.js';
import { validate } from '../../middlewares/validate.js';
import { z } from 'zod';

const idParam = z.object({ id: z.uuid('id không hợp lệ') });

// Chỉ ĐỌC (liệt kê rạp + phòng, xem sơ đồ ghế). Tạo / sửa rạp là mức (S): dữ liệu rạp hiện nạp bằng seed.
export const cinemaRoutes = Router();
cinemaRoutes.get('/', ctrl.list);

export const roomRoutes = Router();
roomRoutes.get('/:id/seats', validate(idParam, 'params'), ctrl.roomSeats);
