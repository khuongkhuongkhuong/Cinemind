import { Router } from 'express';
import { ok } from '../utils/response.js';
import authRoutes from './auth.routes.js';
import catalogRoutes from './catalog.routes.js';
import showtimeRoutes from './showtime.routes.js';
import orderRoutes from './order.routes.js';
import paymentRoutes from './payment.routes.js';
import devRoutes from './dev.routes.js';
import { env } from '../config/env.js';

const router = Router();

router.get('/health', (req, res) => ok(res, { status: 'ok', time: new Date().toISOString() }));
router.use('/auth', authRoutes);
router.use('/', catalogRoutes);
router.use('/', showtimeRoutes);
router.use('/orders', orderRoutes);
router.use('/payments', paymentRoutes);
if (env.NODE_ENV === 'development') router.use('/dev', devRoutes); // mô phỏng IPN, KHÔNG bao giờ bật ở production

// Các router khác (me, staff, admin, ...) sẽ gắn ở đây.

export default router;
