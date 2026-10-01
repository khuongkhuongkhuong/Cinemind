import { Router } from 'express';
import * as ctrl from '../controllers/catalog.controller.js';
import { validate } from '../middlewares/validate.js';
import { listCinemasQuery, listMoviesQuery } from '../validators/catalog.schema.js';

// Toàn bộ là API công khai (không cần đăng nhập).
const router = Router();

router.get('/movies', validate(listMoviesQuery, 'query'), ctrl.listMovies);
router.get('/movies/:slug', ctrl.getMovie);
router.get('/genres', ctrl.listGenres);
router.get('/cities', ctrl.listCities);
router.get('/cinemas', validate(listCinemasQuery, 'query'), ctrl.listCinemas);
router.get('/combos', ctrl.listCombos);
router.get('/banners', ctrl.listBanners);

export default router;
