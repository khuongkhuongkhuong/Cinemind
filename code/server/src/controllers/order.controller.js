import * as bookingService from '../services/booking.service.js';
import { ok } from '../utils/response.js';

// userId luôn lấy từ token (req.user), tuyệt đối không từ body.
export async function create(req, res) {
  const { showtimeId, seatIds } = req.body;
  ok(res, await bookingService.holdSeats({ userId: req.user.id, showtimeId, seatIds }), 201);
}

export async function detail(req, res) {
  ok(res, await bookingService.getOrder({ userId: req.user.id, orderId: req.params.id }));
}

export async function setCombos(req, res) {
  ok(res, await bookingService.setCombos({ userId: req.user.id, orderId: req.params.id, items: req.body.items }));
}

export async function applyPromotion(req, res) {
  ok(res, await bookingService.applyPromotion({ userId: req.user.id, orderId: req.params.id, code: req.body.code }));
}

export async function removePromotion(req, res) {
  ok(res, await bookingService.removePromotion({ userId: req.user.id, orderId: req.params.id }));
}

export async function cancel(req, res) {
  ok(res, await bookingService.cancelOrder({ userId: req.user.id, orderId: req.params.id }));
}
