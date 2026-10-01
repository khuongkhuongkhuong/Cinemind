import { Router } from 'express';
import * as ctrl from '../controllers/staff.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { codeParam } from '../validators/me.schema.js';

const router = Router();
// Quy ước (04 mục 1.4): "STAFF" = STAFF hoặc ADMIN. USER thường bị 403.
router.use(requireAuth, requireRole('STAFF', 'ADMIN'));

router.get('/tickets/:code', validate(codeParam, 'params'), ctrl.lookup);
router.post('/tickets/:code/check-in', validate(codeParam, 'params'), ctrl.checkIn);

export default router;
