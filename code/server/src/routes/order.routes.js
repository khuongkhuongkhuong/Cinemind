import { Router } from 'express';
import * as ctrl from '../controllers/order.controller.js';
import * as paymentCtrl from '../controllers/payment.controller.js';
import { requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import {
  applyPromotionSchema, createOrderSchema, createPaymentSchema, orderIdParam, setCombosSchema,
} from '../validators/order.schema.js';

const router = Router();
router.use(requireAuth); // mọi route đơn hàng đều cần đăng nhập

router.post('/', validate(createOrderSchema), ctrl.create);
router.get('/:id', validate(orderIdParam, 'params'), ctrl.detail);
router.put('/:id/combos', validate(orderIdParam, 'params'), validate(setCombosSchema), ctrl.setCombos);
router.post('/:id/promotion', validate(orderIdParam, 'params'), validate(applyPromotionSchema), ctrl.applyPromotion);
router.delete('/:id/promotion', validate(orderIdParam, 'params'), ctrl.removePromotion);
router.post('/:id/cancel', validate(orderIdParam, 'params'), ctrl.cancel);
router.post('/:id/payments', validate(orderIdParam, 'params'), validate(createPaymentSchema), paymentCtrl.create);

export default router;
