import { Router } from 'express';
import { ok } from '../utils/response.js';
import authRoutes from './auth.routes.js';
import catalogRoutes from './catalog.routes.js';
import showtimeRoutes from './showtime.routes.js';
import orderRoutes from './order.routes.js';

const router = Router();

router.get('/health', (req, res) => ok(res, { status: 'ok', time: new Date().toISOString() }));
router.use('/auth', authRoutes);
router.use('/', catalogRoutes);
router.use('/', showtimeRoutes);
router.use('/orders', orderRoutes);

// Các router khác (payment, me, ...) sẽ gắn ở đây.

export default router;
