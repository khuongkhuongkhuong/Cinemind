import { Router } from 'express';
import { ok } from '../utils/response.js';
import authRoutes from './auth.routes.js';

const router = Router();

router.get('/health', (req, res) => ok(res, { status: 'ok', time: new Date().toISOString() }));
router.use('/auth', authRoutes);

// Các router khác (catalog, showtime, ...) sẽ gắn ở đây.

export default router;
