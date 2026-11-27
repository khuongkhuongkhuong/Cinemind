import { Router } from 'express';
import * as ctrl from '../controllers/auth.controller.js';
import { requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { rateLimit } from '../middlewares/rateLimit.js';
import { forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema, verifyEmailSchema } from '../validators/auth.schema.js';

const router = Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, max: 20 }); // chống dò mật khẩu
const registerLimiter = rateLimit({ windowMs: 60 * 60_000, max: 20 }); // chống tạo hàng loạt tài khoản rác
const refreshLimiter = rateLimit({ windowMs: 15 * 60_000, max: 60 }); // mỗi người chỉ refresh ~1 lần / 15 phút; dư cho nhiều tab

// Mã 6 số còn có giới hạn riêng trong emailCode.service (5 lần nhập / mã, 5 mã / giờ / tài khoản); đây là lớp theo IP.
const codeLimiter = rateLimit({ windowMs: 15 * 60_000, max: 20 });
const mailLimiter = rateLimit({ windowMs: 60 * 60_000, max: 10 }); // chống dùng hệ thống để rải thư

router.post('/register', registerLimiter, validate(registerSchema), ctrl.register);
router.post('/login', loginLimiter, validate(loginSchema), ctrl.login);
router.post('/refresh', refreshLimiter, ctrl.refresh);
router.post('/logout', requireAuth, ctrl.logout);
router.get('/me', requireAuth, ctrl.me);
router.post('/verify-email', codeLimiter, requireAuth, validate(verifyEmailSchema), ctrl.verifyEmail);
router.post('/resend-code', mailLimiter, requireAuth, ctrl.resendCode);
router.post('/forgot-password', mailLimiter, validate(forgotPasswordSchema), ctrl.forgotPassword);
router.post('/reset-password', codeLimiter, validate(resetPasswordSchema), ctrl.resetPassword);

export default router;
