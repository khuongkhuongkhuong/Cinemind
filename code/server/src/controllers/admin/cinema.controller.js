import * as cinemaService from '../../services/adminCinema.service.js';
import * as roomService from '../../services/room.service.js';
import { ok } from '../../utils/response.js';

export async function list(req, res) {
  ok(res, await cinemaService.listAdminCinemas());
}

export async function roomSeats(req, res) {
  ok(res, await cinemaService.getRoomSeats({ roomId: req.params.id }));
}

export async function create(req, res) {
  ok(res, await cinemaService.createCinema(req.body), 201);
}

export async function update(req, res) {
  ok(res, await cinemaService.updateCinema({ cinemaId: req.params.id, ...req.body }));
}

export async function createRoom(req, res) {
  ok(res, await roomService.createRoom({ cinemaId: req.params.id, ...req.body }), 201);
}

export async function updateRoom(req, res) {
  ok(res, await roomService.updateRoom({ roomId: req.params.id, ...req.body }));
}

export async function deleteRoom(req, res) {
  await roomService.deleteRoom({ roomId: req.params.id });
  res.status(204).end();
}
