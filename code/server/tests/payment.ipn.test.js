// ⭐ Test IPN VNPay: chữ ký, số tiền, idempotent, đến muộn, ghế đã mất.
// Cần dữ liệu mẫu: chạy `npm run db:seed` trước.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'development'; // để route /dev/.../simulate được bật
const { prisma } = await import('../src/config/prisma.js');
const { env } = await import('../src/config/env.js');
const { holdSeats, expirePendingOrders } = await import('../src/services/booking.service.js');
const { createPayment, confirmPayment, getPaymentStatus } = await import('../src/services/payment.service.js');
const { sign, verifySignature } = await import('../src/lib/vnpay.js');
const { default: app } = await import('../src/app.js');
const { signAccessToken } = await import('../src/lib/jwt.js');

const minute = 60_000;
const RUN = Date.now();
let showtime;
let seats;
const users = [];

const seat = (label) => seats.find((s) => `${s.row}${s.number}` === label);
const failCode = (promise) => promise.then(() => null, (e) => e.code);
const makeUser = async () => {
  const u = await prisma.user.create({
    data: { email: `test-pay-${RUN}-${users.length}@example.com`, passwordHash: 'x', fullName: 'Test' },
  });
  users.push(u);
  return u;
};
const hold = (user, ...labels) =>
  holdSeats({ userId: user.id, showtimeId: showtime.id, seatIds: labels.map((l) => seat(l).id) });

/** Dựng một IPN VNPay có chữ ký hợp lệ; `override` để ghi đè trường (sau đó ký lại hoặc không). */
const ipn = (payment, override = {}, { resign = true } = {}) => {
  const q = {
    vnp_TmnCode: env.VNP_TMN_CODE, vnp_Amount: String(payment.amount * 100), vnp_BankCode: 'NCB',
    vnp_TxnRef: payment.txnRef, vnp_TransactionNo: '14000001', vnp_ResponseCode: '00', vnp_TransactionStatus: '00',
    ...override,
  };
  q.vnp_SecureHash = resign ? sign(q, env.VNP_HASH_SECRET) : 'chu-ky-gia';
  return q;
};
const rsp = async (query) => (await confirmPayment({ query })).RspCode;

/** Tạo user + đơn + giao dịch đang chờ. */
async function setup(...labels) {
  const user = await makeUser();
  const order = await hold(user, ...labels);
  const { txnRef } = await createPayment({ userId: user.id, orderId: order.id });
  const payment = await prisma.payment.findUnique({ where: { txnRef } });
  return { user, order, payment };
}
const orderRow = (id) => prisma.order.findUnique({ where: { id } });
const locksOf = (orderId) => prisma.seatLock.findMany({ where: { orderId } });
// Đưa đơn về "đã hết hạn, và cron đã dọn" mà không phải chờ 10 phút thật.
async function expireAndSweep(orderId) {
  await prisma.order.update({ where: { id: orderId }, data: { expiresAt: new Date(Date.now() - minute) } });
  await prisma.seatLock.updateMany({ where: { orderId }, data: { expiresAt: new Date(Date.now() - minute) } });
  await expirePendingOrders();
}

before(async () => {
  [showtime] = await prisma.showtime.findMany({ where: { status: 'OPEN' }, orderBy: { startTime: 'desc' }, skip: 2, take: 1 });
  seats = await prisma.seat.findMany({ where: { roomId: showtime.roomId } });
});

after(async () => {
  const userIds = users.map((u) => u.id);
  await prisma.payment.deleteMany({ where: { order: { userId: { in: userIds } } } }); // Payment không cascade
  await prisma.order.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

test('createPayment: URL có chữ ký hợp lệ, số tiền x100, hạn = hạn giữ ghế (BR-30)', async () => {
  const user = await makeUser();
  const order = await hold(user, 'A1', 'A2');
  const res = await createPayment({ userId: user.id, orderId: order.id, bankCode: 'NCB' });
  const url = new URL(res.paymentUrl);
  const query = Object.fromEntries(url.searchParams);
  assert.equal(query.vnp_Amount, String(order.total * 100));
  assert.equal(query.vnp_TxnRef, res.txnRef);
  assert.match(res.txnRef, new RegExp(`^${order.code}-1$`));
  assert.ok(verifySignature(query, env.VNP_HASH_SECRET), 'chữ ký phải hợp lệ');
  assert.equal(res.expiresAt.getTime(), new Date(order.expiresAt).getTime());
  // bấm thanh toán lần 2 -> giao dịch mới, mã -2
  assert.match((await createPayment({ userId: user.id, orderId: order.id })).txnRef, /-2$/);
});

test('createPayment: người khác -> FORBIDDEN; đơn đã hủy -> ORDER_NOT_PENDING; đơn hết hạn -> ORDER_EXPIRED', async () => {
  const owner = await makeUser();
  const stranger = await makeUser();
  const order = await hold(owner, 'B1');
  assert.equal(await failCode(createPayment({ userId: stranger.id, orderId: order.id })), 'FORBIDDEN');
  await prisma.order.update({ where: { id: order.id }, data: { expiresAt: new Date(Date.now() - minute) } });
  assert.equal(await failCode(createPayment({ userId: owner.id, orderId: order.id })), 'ORDER_EXPIRED');
  await prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
  assert.equal(await failCode(createPayment({ userId: owner.id, orderId: order.id })), 'ORDER_NOT_PENDING');
});

test('⭐ IPN thành công: đơn PAID, ghế SOLD không hết hạn, giao dịch SUCCESS, cộng điểm', async () => {
  const { user, order, payment } = await setup('C1', 'C2');
  assert.equal(await rsp(ipn(payment)), '00');

  const paid = await orderRow(order.id);
  assert.equal(paid.status, 'PAID');
  assert.ok(paid.paidAt);
  const locks = await locksOf(order.id);
  assert.equal(locks.length, 2);
  assert.ok(locks.every((l) => l.status === 'SOLD' && l.expiresAt === null));
  const p = await prisma.payment.findUnique({ where: { id: payment.id } });
  assert.equal(p.status, 'SUCCESS');
  assert.equal(p.providerTxnNo, '14000001');
  assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).points, Math.floor(order.total / 10000));
});

test('⭐ chữ ký sai (97), không tìm thấy (01), sai số tiền (04): đơn KHÔNG bị đổi trạng thái', async () => {
  const { order, payment } = await setup('D1');
  assert.equal(await rsp(ipn(payment, {}, { resign: false })), '97'); // chữ ký giả
  const tampered = ipn(payment);
  tampered.vnp_Amount = '100'; // sửa số tiền nhưng giữ chữ ký cũ
  assert.equal(await rsp(tampered), '97');
  assert.equal(await rsp(ipn(payment, { vnp_Amount: '100' })), '04'); // ký lại hợp lệ nhưng sai tiền
  assert.equal(await rsp(ipn(payment, { vnp_TxnRef: 'KHONG-CO-1' })), '01');
  assert.equal((await orderRow(order.id)).status, 'PENDING');
  assert.equal((await prisma.payment.findUnique({ where: { id: payment.id } })).status, 'PENDING');
});

test('⭐ idempotent: gửi lại IPN -> 02; 10 IPN giống hệt chạy ĐỒNG THỜI chỉ có đúng 1 cái xử lý, điểm cộng 1 lần', async () => {
  const { user, order, payment } = await setup('E1', 'E2', 'E3');
  const results = await Promise.all(Array.from({ length: 10 }, () => rsp(ipn(payment))));
  assert.equal(results.filter((c) => c === '00').length, 1);
  assert.equal(results.filter((c) => c === '02').length, 9);
  assert.equal(await rsp(ipn(payment)), '02'); // gọi lại sau đó cũng vậy
  assert.equal((await orderRow(order.id)).status, 'PAID');
  assert.equal((await locksOf(order.id)).length, 3);
  assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).points, Math.floor(order.total / 10000));
});

test('thanh toán thất bại (khách hủy): giao dịch FAILED, đơn vẫn PENDING và ghế vẫn được giữ', async () => {
  const { order, payment } = await setup('F1');
  assert.equal(await rsp(ipn(payment, { vnp_ResponseCode: '24', vnp_TransactionStatus: '02' })), '00');
  assert.equal((await prisma.payment.findUnique({ where: { id: payment.id } })).status, 'FAILED');
  assert.equal((await orderRow(order.id)).status, 'PENDING');
  assert.equal((await locksOf(order.id))[0].status, 'HELD');
});

test('ResponseCode 00 nhưng TransactionStatus khác 00 thì KHÔNG coi là thành công', async () => {
  const { order, payment } = await setup('F2');
  assert.equal(await rsp(ipn(payment, { vnp_TransactionStatus: '01' })), '00');
  assert.equal((await orderRow(order.id)).status, 'PENDING');
});

test('⭐ IPN đến MUỘN nhưng ghế còn trống: đơn hết hạn vẫn được xác nhận PAID (BR-31)', async () => {
  const { order, payment } = await setup('G1', 'G2');
  await expireAndSweep(order.id);
  assert.equal((await orderRow(order.id)).status, 'EXPIRED');
  assert.equal((await locksOf(order.id)).length, 0); // cron đã nhả ghế

  assert.equal(await rsp(ipn(payment)), '00');
  assert.equal((await orderRow(order.id)).status, 'PAID');
  const locks = await locksOf(order.id);
  assert.equal(locks.length, 2);
  assert.ok(locks.every((l) => l.status === 'SOLD'));
});

test('⭐ IPN đến MUỘN và ghế ĐÃ BỊ NGƯỜI KHÁC LẤY: đơn -> REFUND_PENDING, giao dịch SUCCESS, không bán trùng (BR-31)', async () => {
  const { order, payment } = await setup('G5', 'G6');
  await expireAndSweep(order.id);
  const rival = await makeUser();
  const rivalOrder = await hold(rival, 'G6'); // người khác giữ được G6 sau khi đơn hết hạn

  assert.equal(await rsp(ipn(payment)), '00'); // vẫn trả 00 để VNPay ngừng gọi lại
  assert.equal((await orderRow(order.id)).status, 'REFUND_PENDING');
  assert.equal((await prisma.payment.findUnique({ where: { id: payment.id } })).status, 'SUCCESS');
  // ghế của đối thủ nguyên vẹn; đơn đến muộn KHÔNG chiếm ghế nào (rollback sạch)
  assert.equal((await locksOf(rivalOrder.id)).length, 1);
  assert.equal((await locksOf(order.id)).length, 0);
  assert.equal(await rsp(ipn(payment)), '02');
});

test('getPaymentStatus chỉ đọc, chỉ chủ giao dịch xem được; trang return không đổi trạng thái đơn', async () => {
  const { user, order, payment } = await setup('H1', 'H2'); // ghế đôi
  const stranger = await makeUser();
  assert.equal(await failCode(getPaymentStatus({ userId: stranger.id, txnRef: payment.txnRef })), 'NOT_FOUND');
  const s = await getPaymentStatus({ userId: user.id, txnRef: payment.txnRef });
  assert.deepEqual(s, { orderId: order.id, orderStatus: 'PENDING', paymentStatus: 'PENDING' });
});

test('HTTP: tạo thanh toán -> IPN qua query -> status; và cổng giả lập /dev/.../simulate', async () => {
  const user = await makeUser();
  const order = await hold(user, 'A5');
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}/api/v1`;
  const token = signAccessToken({ id: user.id, role: 'USER' });
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  try {
    const created = await fetch(`${base}/orders/${order.id}/payments`, { method: 'POST', headers: auth, body: '{}' });
    assert.equal(created.status, 201);
    const { txnRef, paymentUrl } = (await created.json()).data;
    assert.ok(paymentUrl.startsWith(env.VNP_URL));

    // IPN thật qua HTTP: không cần token, trả đúng định dạng VNPay (không có "success")
    const payment = await prisma.payment.findUnique({ where: { txnRef } });
    const bad = await (await fetch(`${base}/payments/vnpay/ipn?${new URLSearchParams(ipn(payment, {}, { resign: false }))}`)).json();
    assert.deepEqual(bad, { RspCode: '97', Message: 'Invalid signature' });

    const sim = await fetch(`${base}/dev/payments/${txnRef}/simulate`, { method: 'POST', headers: auth, body: JSON.stringify({ result: 'SUCCESS' }) });
    assert.deepEqual(await sim.json(), { RspCode: '00', Message: 'Confirm Success' });

    const status = await (await fetch(`${base}/payments/${txnRef}/status`, { headers: auth })).json();
    assert.equal(status.data.orderStatus, 'PAID');
    assert.equal((await fetch(`${base}/payments/${txnRef}/status`)).status, 401);
  } finally {
    server.close();
  }
});
