import { Router } from 'express';
import * as ctrl from '../controllers/chat.controller.js';
import { requireAuth, requireFreshRole } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { rateLimit } from '../middlewares/rateLimit.js';
import { chatSchema, confirmSchema, sessionIdParam } from '../validators/ai.schema.js';

const router = Router();
// Trợ lý AI tốn chi phí LLM nên: phải đăng nhập, và trạng thái tài khoản được đọc LẠI từ DB mỗi request
// (tài khoản bị khóa thì không chat được ngay, không chờ token hết hạn). Mọi vai trò đã đăng nhập đều dùng được.
router.use(requireAuth, requireFreshRole('USER', 'STAFF', 'ADMIN'));
// Lớp chặn thứ hai theo IP (ngoài giới hạn theo tài khoản trong chat.service): 60 yêu cầu / phút / IP.
router.use(rateLimit({ windowMs: 60_000, max: 60 }));

router.post('/chat', validate(chatSchema), ctrl.chat);
router.post('/confirm', validate(confirmSchema), ctrl.confirm);
router.get('/sessions/:id', validate(sessionIdParam, 'params'), ctrl.getSession);
router.delete('/sessions/:id', validate(sessionIdParam, 'params'), ctrl.closeSession);

export default router;
