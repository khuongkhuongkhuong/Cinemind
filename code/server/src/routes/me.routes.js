import { Router } from 'express';
import * as ctrl from '../controllers/me.controller.js';
import { requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { codeParam, myOrdersQuery } from '../validators/me.schema.js';

const router = Router();
router.use(requireAuth);

router.get('/orders', validate(myOrdersQuery, 'query'), ctrl.listOrders);
router.get('/orders/:code', validate(codeParam, 'params'), ctrl.orderByCode);

export default router;
