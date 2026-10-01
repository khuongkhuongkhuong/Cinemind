import * as showtimeService from '../../services/showtime.service.js';
import { ok, okPaged } from '../../utils/response.js';

export async function list(req, res) {
  const { items, meta } = await showtimeService.listAdminShowtimes(req.query);
  okPaged(res, items, meta);
}

export async function create(req, res) {
  ok(res, await showtimeService.createShowtime(req.body), 201);
}

export async function update(req, res) {
  ok(res, await showtimeService.updateShowtime({ showtimeId: req.params.id, ...req.body }));
}

export async function cancel(req, res) {
  ok(res, await showtimeService.cancelShowtime({ showtimeId: req.params.id }));
}
