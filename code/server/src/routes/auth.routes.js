import { Router } from 'express';
import * as ctrl from '../controllers/auth.controller.js';
import { requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { rateLimit } from '../middlewares/rateLimit.js';
import { loginSchema, registerSchema } from '../validators/auth.schema.js';

const router = Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, max: 20 }); // chống dò mật khẩu
const registerLimiter = rateLimit({ windowMs: 60 * 60_000, max: 20 }); // chống tạo hàng loạt tài khoản rác
const refreshLimiter = rateLimit({ windowMs: 15 * 60_000, max: 60 }); // mỗi người chỉ refresh ~1 lần / 15 phút; dư cho nhiều tab

router.post('/register', registerLimiter, validate(registerSchema), ctrl.register);
router.post('/login', loginLimiter, validate(loginSchema), ctrl.login);
router.post('/refresh', refreshLimiter, ctrl.refresh);
router.post('/logout', requireAuth, ctrl.logout);
router.get('/me', requireAuth, ctrl.me);

export default router;
