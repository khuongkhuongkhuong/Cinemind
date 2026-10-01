import * as paymentService from '../services/payment.service.js';
import { ok } from '../utils/response.js';

// Địa chỉ IP khách gửi VNPay (bỏ tiền tố IPv4-mapped "::ffff:").
const clientIp = (req) => (req.ip ?? '127.0.0.1').replace(/^::ffff:/, '');

export async function create(req, res) {
  const data = await paymentService.createPayment({
    userId: req.user.id, orderId: req.params.id, bankCode: req.body.bankCode, ipAddr: clientIp(req),
  });
  ok(res, data, 201);
}

// IPN: VNPay gọi, KHÔNG có token người dùng; trả đúng định dạng của VNPay chứ không theo { success, data }.
export async function ipn(req, res) {
  res.json(await paymentService.confirmPayment({ query: req.query }));
}

export async function status(req, res) {
  ok(res, await paymentService.getPaymentStatus({ userId: req.user.id, txnRef: req.params.txnRef }));
}

export async function simulate(req, res) {
  res.json(await paymentService.simulateIpn({ txnRef: req.params.txnRef, result: req.body.result }));
}
