import { Router } from 'express';
import * as ctrl from '../controllers/me.controller.js';
import { requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { rateLimit } from '../middlewares/rateLimit.js';
import { changePasswordSchema, codeParam, myOrdersQuery, updateProfileSchema } from '../validators/me.schema.js';

const router = Router();
router.use(requireAuth);
const passwordLimiter = rateLimit({ windowMs: 15 * 60_000, max: 10 }); // chống dò mật khẩu hiện tại bằng access token đánh cắp

router.get('/orders', validate(myOrdersQuery, 'query'), ctrl.listOrders);
router.get('/orders/:code', validate(codeParam, 'params'), ctrl.orderByCode);
router.patch('/profile', validate(updateProfileSchema), ctrl.updateProfile);
router.put('/password', passwordLimiter, validate(changePasswordSchema), ctrl.changePassword);

export default router;
