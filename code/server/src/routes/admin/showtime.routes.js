import { Router } from 'express';
import * as ctrl from '../../controllers/admin/showtime.controller.js';
import { validate } from '../../middlewares/validate.js';
import {
  adminShowtimesQuery, createShowtimeSchema, showtimeIdParam, updateShowtimeSchema,
} from '../../validators/admin.showtime.schema.js';

const router = Router();

router.get('/', validate(adminShowtimesQuery, 'query'), ctrl.list);
router.post('/', validate(createShowtimeSchema), ctrl.create);
router.put('/:id', validate(showtimeIdParam, 'params'), validate(updateShowtimeSchema), ctrl.update);
router.patch('/:id/cancel', validate(showtimeIdParam, 'params'), ctrl.cancel);

export default router;
