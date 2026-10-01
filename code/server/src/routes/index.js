import { Router } from 'express';
import { ok } from '../utils/response.js';
import catalogRoutes from './catalog.routes.js';

const router = Router();

router.get('/health', (req, res) => ok(res, { status: 'ok', time: new Date().toISOString() }));
router.use('/', catalogRoutes);

// Các router khác (showtime, auth, ...) sẽ gắn ở đây.

export default router;
