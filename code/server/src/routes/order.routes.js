import { Router } from 'express';
import * as ctrl from '../controllers/order.controller.js';
import * as paymentCtrl from '../controllers/payment.controller.js';
import { requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { createOrderSchema, createPaymentSchema, orderIdParam } from '../validators/order.schema.js';

const router = Router();
router.use(requireAuth); // mọi route đơn hàng đều cần đăng nhập

router.post('/', validate(createOrderSchema), ctrl.create);
router.get('/:id', validate(orderIdParam, 'params'), ctrl.detail);
router.post('/:id/cancel', validate(orderIdParam, 'params'), ctrl.cancel);
router.post('/:id/payments', validate(orderIdParam, 'params'), validate(createPaymentSchema), paymentCtrl.create);

export default router;
