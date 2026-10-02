import { Router } from 'express';
import { requireAuth, requireFreshRole } from '../../middlewares/auth.js';
import { auditWrites } from '../../middlewares/audit.js';
import auditRoutes from './audit.routes.js';
import showtimeRoutes from './showtime.routes.js';
import orderRoutes from './order.routes.js';
import reportRoutes from './report.routes.js';
import movieRoutes from './movie.routes.js';
import userRoutes from './user.routes.js';
import { comboRoutes, genreRoutes, promotionRoutes } from './catalog.routes.js';
import { bannerRoutes, pricingRoutes } from './pricing.routes.js';
import { cinemaRoutes, roomRoutes } from './cinema.routes.js';

// Toàn bộ /admin/* chỉ dành cho ADMIN (04 mục 1.4). Khai báo quyền MỘT lần ở đây để không route admin nào bị sót.
const router = Router();
router.use(requireAuth, requireFreshRole('ADMIN'), auditWrites); // sau khi biết ai đang thao tác
router.use('/audit-logs', auditRoutes);

router.use('/showtimes', showtimeRoutes);
router.use('/orders', orderRoutes);
router.use('/reports', reportRoutes);
router.use('/movies', movieRoutes);
router.use('/users', userRoutes);
router.use('/genres', genreRoutes);
router.use('/combos', comboRoutes);
router.use('/promotions', promotionRoutes);
router.use('/pricing', pricingRoutes);
router.use('/banners', bannerRoutes);
router.use('/cinemas', cinemaRoutes);
router.use('/rooms', roomRoutes);

export default router;
