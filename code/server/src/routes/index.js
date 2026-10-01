import { Router } from 'express';
import { ok } from '../utils/response.js';
import showtimeRoutes from './showtime.routes.js';

const router = Router();

router.get('/health', (req, res) => ok(res, { status: 'ok', time: new Date().toISOString() }));
router.use('/', showtimeRoutes);

// Các router khác (auth, catalog, ...) sẽ gắn ở đây.

export default router;
