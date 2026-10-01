import * as catalogService from '../services/catalog.service.js';
import { ok, okPaged } from '../utils/response.js';

export async function listMovies(req, res) {
  const { items, meta } = await catalogService.listMovies(req.query);
  okPaged(res, items, meta);
}

export async function getMovie(req, res) {
  ok(res, await catalogService.getMovieBySlug({ slug: req.params.slug }));
}

export async function listGenres(req, res) {
  ok(res, await catalogService.listGenres());
}

export async function listCities(req, res) {
  ok(res, await catalogService.listCities());
}

export async function listCinemas(req, res) {
  ok(res, await catalogService.listCinemas(req.query));
}

export async function listCombos(req, res) {
  ok(res, await catalogService.listCombos());
}

export async function listBanners(req, res) {
  ok(res, await catalogService.listBanners());
}
