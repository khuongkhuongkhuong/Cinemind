import { Router } from 'express';
import * as ctrl from '../../controllers/admin/order.controller.js';
import { validate } from '../../middlewares/validate.js';
import { adminOrderIdParam, adminOrdersQuery } from '../../validators/admin.order.schema.js';

const router = Router();

router.get('/', validate(adminOrdersQuery, 'query'), ctrl.list);
router.get('/:id', validate(adminOrderIdParam, 'params'), ctrl.detail);
router.patch('/:id/refund', validate(adminOrderIdParam, 'params'), ctrl.refund);

export default router;
