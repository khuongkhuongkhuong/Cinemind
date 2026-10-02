import { Router } from 'express';
import * as ctrl from '../controllers/showtime.controller.js';
import { validate } from '../middlewares/validate.js';
import { cinemaIdParam, cinemaShowtimesQuery, idParam, movieIdParam, movieShowtimesQuery } from '../validators/showtime.schema.js';

// Công khai. Gắn ở /api/v1 (đường dẫn đầy đủ nằm trong từng route).
const router = Router();

router.get('/movies/:movieId/showtimes', validate(movieIdParam, 'params'), validate(movieShowtimesQuery, 'query'), ctrl.listByMovie);
router.get('/cinemas/:cinemaId/showtimes', validate(cinemaIdParam, 'params'), validate(cinemaShowtimesQuery, 'query'), ctrl.listByCinema);
router.get('/showtimes/:id', validate(idParam, 'params'), ctrl.detail);
router.get('/showtimes/:id/seats', validate(idParam, 'params'), ctrl.seats);

export default router;
