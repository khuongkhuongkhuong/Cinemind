import * as cinemaService from '../../services/adminCinema.service.js';
import { ok } from '../../utils/response.js';

export async function list(req, res) {
  ok(res, await cinemaService.listAdminCinemas());
}

export async function roomSeats(req, res) {
  ok(res, await cinemaService.getRoomSeats({ roomId: req.params.id }));
}
