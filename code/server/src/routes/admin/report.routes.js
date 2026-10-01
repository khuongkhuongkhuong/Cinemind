import { Router } from 'express';
import * as ctrl from '../../controllers/admin/report.controller.js';
import { validate } from '../../middlewares/validate.js';
import { revenueQuery } from '../../validators/admin.report.schema.js';

const router = Router();

router.get('/revenue', validate(revenueQuery, 'query'), ctrl.revenue);

export default router;
