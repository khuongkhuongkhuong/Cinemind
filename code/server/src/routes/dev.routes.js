import { Router } from 'express';
import * as ctrl from '../controllers/payment.controller.js';
import { validate } from '../middlewares/validate.js';
import { simulateSchema } from '../validators/order.schema.js';

// Chỉ được gắn khi NODE_ENV=development (xem routes/index.js). Không có đăng nhập vì mô phỏng VNPay.
const router = Router();
router.post('/payments/:txnRef/simulate', validate(simulateSchema), ctrl.simulate);

export default router;
