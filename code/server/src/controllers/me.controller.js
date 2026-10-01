import * as bookingService from '../services/booking.service.js';
import { ok, okPaged } from '../utils/response.js';

// userId luôn lấy từ token, không bao giờ từ query/body.
export async function listOrders(req, res) {
  const { items, meta } = await bookingService.listMyOrders({ userId: req.user.id, ...req.query });
  okPaged(res, items, meta);
}

export async function orderByCode(req, res) {
  ok(res, await bookingService.getMyOrderByCode({ userId: req.user.id, code: req.params.code }));
}
