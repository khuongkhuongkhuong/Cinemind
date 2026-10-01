import { Router } from 'express';
import { requireAuth, requireFreshRole } from '../../middlewares/auth.js';
import showtimeRoutes from './showtime.routes.js';
import orderRoutes from './order.routes.js';
import reportRoutes from './report.routes.js';
import movieRoutes from './movie.routes.js';
import userRoutes from './user.routes.js';

// Toàn bộ /admin/* chỉ dành cho ADMIN (04 mục 1.4). Khai báo quyền MỘT lần ở đây để không route admin nào bị sót.
const router = Router();
router.use(requireAuth, requireFreshRole('ADMIN'));

router.use('/showtimes', showtimeRoutes);
router.use('/orders', orderRoutes);
router.use('/reports', reportRoutes);
router.use('/movies', movieRoutes);
router.use('/users', userRoutes);

export default router;
