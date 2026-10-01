import { Router } from 'express';
import * as ctrl from '../../controllers/admin/movie.controller.js';
import { validate } from '../../middlewares/validate.js';
import {
  adminMoviesQuery, createMovieSchema, movieIdParam, movieStatusSchema, updateMovieSchema,
} from '../../validators/admin.movie.schema.js';

const router = Router();

router.get('/', validate(adminMoviesQuery, 'query'), ctrl.list);
router.post('/', validate(createMovieSchema), ctrl.create);
router.get('/:id', validate(movieIdParam, 'params'), ctrl.detail);
router.put('/:id', validate(movieIdParam, 'params'), validate(updateMovieSchema), ctrl.update);
router.patch('/:id/status', validate(movieIdParam, 'params'), validate(movieStatusSchema), ctrl.setStatus);
router.delete('/:id', validate(movieIdParam, 'params'), ctrl.remove);

export default router;
