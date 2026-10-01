import { Router } from 'express';
import { ok } from '../utils/response.js';

const router = Router();

router.get('/health', (req, res) => ok(res, { status: 'ok', time: new Date().toISOString() }));

// Các router khác (auth, catalog, ...) sẽ gắn ở đây khi làm Sprint 1.

export default router;
