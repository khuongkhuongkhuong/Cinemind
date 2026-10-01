import { Router } from 'express';
import { ok } from '../utils/response.js';
import authRoutes from './auth.routes.js';
import catalogRoutes from './catalog.routes.js';
import showtimeRoutes from './showtime.routes.js';
import orderRoutes from './order.routes.js';
import meRoutes from './me.routes.js';
import staffRoutes from './staff.routes.js';
import adminRoutes from './admin/index.js';
import paymentRoutes from './payment.routes.js';
import devRoutes from './dev.routes.js';
import { env } from '../config/env.js';

const router = Router();

router.get('/health', (req, res) => ok(res, { status: 'ok', time: new Date().toISOString() }));
router.use('/auth', authRoutes);
router.use('/', catalogRoutes);
router.use('/', showtimeRoutes);
router.use('/orders', orderRoutes);
router.use('/me', meRoutes);
router.use('/staff', staffRoutes);
router.use('/admin', adminRoutes);
router.use('/payments', paymentRoutes);
// Cổng giả lập IPN: cần CẢ NODE_ENV=development LẪN ENABLE_DEV_ROUTES=true (xem config/env.js). Không bao giờ ở production.
export const devRoutesEnabled = env.NODE_ENV === 'development' && env.ENABLE_DEV_ROUTES;
if (devRoutesEnabled) router.use('/dev', devRoutes);

// Còn lại sẽ gắn ở đây khi làm tiếp (admin: phim, đơn, báo cáo...).

export default router;
