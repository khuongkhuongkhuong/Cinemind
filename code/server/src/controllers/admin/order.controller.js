import * as adminOrderService from '../../services/adminOrder.service.js';
import { ok, okPaged } from '../../utils/response.js';

export async function list(req, res) {
  const { items, meta } = await adminOrderService.listAdminOrders(req.query);
  okPaged(res, items, meta);
}

export async function detail(req, res) {
  ok(res, await adminOrderService.getAdminOrder({ orderId: req.params.id }));
}

export async function refund(req, res) {
  ok(res, await adminOrderService.refundOrder({ orderId: req.params.id }));
}
