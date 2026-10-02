import { Router } from 'express';
import * as ctrl from '../../controllers/admin/audit.controller.js';
import { validate } from '../../middlewares/validate.js';
import { auditLogsQuery } from '../../validators/admin.audit.schema.js';

// Chỉ ĐỌC. Nhật ký chỉ được thêm bởi middleware auditWrites, không có API sửa / xóa.
const router = Router();
router.get('/', validate(auditLogsQuery, 'query'), ctrl.list);
export default router;
