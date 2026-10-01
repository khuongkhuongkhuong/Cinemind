import { Router } from 'express';
import * as ctrl from '../controllers/payment.controller.js';
import { requireAuth } from '../middlewares/auth.js';

const router = Router();

// VNPay gọi — công khai (xác thực bằng chữ ký, không bằng token). Chỉ endpoint này được đổi đơn sang PAID.
router.get('/vnpay/ipn', ctrl.ipn);
// Trang kết quả hỏi định kỳ — chỉ đọc.
router.get('/:txnRef/status', requireAuth, ctrl.status);

export default router;
