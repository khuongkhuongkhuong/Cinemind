import * as showtimeService from '../services/showtime.service.js';
import { ok } from '../utils/response.js';

export async function listByMovie(req, res) {
  ok(res, await showtimeService.listShowtimesByMovie({ movieId: req.params.movieId, ...req.query }));
}

export async function detail(req, res) {
  ok(res, await showtimeService.getShowtime({ showtimeId: req.params.id }));
}

export async function seats(req, res) {
  ok(res, await showtimeService.getSeatMap({ showtimeId: req.params.id }));
}

export async function listByCinema(req, res) {
  ok(res, await showtimeService.listShowtimesByCinema({ cinemaId: req.params.cinemaId, ...req.query }));
}
