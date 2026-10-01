import * as bookingService from '../services/booking.service.js';
import * as userService from '../services/user.service.js';
import { setRefreshCookie } from './auth.controller.js';
import { ok, okPaged } from '../utils/response.js';

// userId luôn lấy từ token, không bao giờ từ query/body.
export async function listOrders(req, res) {
  const { items, meta } = await bookingService.listMyOrders({ userId: req.user.id, ...req.query });
  okPaged(res, items, meta);
}

export async function orderByCode(req, res) {
  ok(res, await bookingService.getMyOrderByCode({ userId: req.user.id, code: req.params.code }));
}

export async function updateProfile(req, res) {
  ok(res, await userService.updateProfile({ userId: req.user.id, ...req.body }));
}

export async function changePassword(req, res) {
  const { refreshToken } = await userService.changePassword({ userId: req.user.id, ...req.body });
  setRefreshCookie(res, refreshToken); // thiết bị đang dùng giữ được phiên; các thiết bị khác đã bị thu hồi
  res.status(204).end();
}
