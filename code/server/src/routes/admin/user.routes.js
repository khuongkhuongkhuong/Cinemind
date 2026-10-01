import { Router } from 'express';
import * as ctrl from '../../controllers/admin/user.controller.js';
import { validate } from '../../middlewares/validate.js';
import { adminUsersQuery, createStaffSchema, updateUserSchema, userIdParam } from '../../validators/admin.user.schema.js';

const router = Router();

router.get('/', validate(adminUsersQuery, 'query'), ctrl.list);
router.post('/', validate(createStaffSchema), ctrl.createStaff);
router.patch('/:id', validate(userIdParam, 'params'), validate(updateUserSchema), ctrl.update);

export default router;
