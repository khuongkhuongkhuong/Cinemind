import * as movieService from '../../services/adminMovie.service.js';
import { ok, okPaged } from '../../utils/response.js';

export async function list(req, res) {
  const { items, meta } = await movieService.listAdminMovies(req.query);
  okPaged(res, items, meta);
}

export async function detail(req, res) {
  ok(res, await movieService.getAdminMovie({ movieId: req.params.id }));
}

export async function create(req, res) {
  ok(res, await movieService.createMovie(req.body), 201);
}

export async function update(req, res) {
  ok(res, await movieService.updateMovie({ movieId: req.params.id, ...req.body }));
}

export async function setStatus(req, res) {
  ok(res, await movieService.setMovieStatus({ movieId: req.params.id, status: req.body.status }));
}

export async function remove(req, res) {
  await movieService.deleteMovie({ movieId: req.params.id });
  res.status(204).end();
}
