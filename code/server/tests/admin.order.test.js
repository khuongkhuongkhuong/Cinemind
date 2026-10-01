// Quản trị đơn hàng: danh sách, chi tiết kèm giao dịch, ghi nhận hoàn tiền (REFUND_PENDING -> REFUNDED).
// Cần dữ liệu mẫu: chạy `npm run db:seed` trước.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { prisma } = await import('../src/config/prisma.js');
const svc = await import('../src/services/adminOrder.service.js');
const { lookupTicket } = await import('../src/services/ticket.service.js');
const { default: app } = await import('../src/app.js');
const { signAccessToken } = await import('../src/lib/jwt.js');

const RUN = Date.now();
const minute = 60_000;
let showtime;
let alice; let bob;
const orders = {};
let n = 0;

const failCode = (p) => p.then(() => null, (e) => e.code);
const makeOrder = (user, data = {}) => prisma.order.create({
  data: {
    code: `R${RUN}${n++}`.slice(-10).toUpperCase(), userId: user.id, showtimeId: showtime.id,
    expiresAt: new Date(Date.now() + 10 * minute), seatTotal: 100_000, total: 100_000, ...data,
  },
});

before(async () => {
  showtime = await prisma.showtime.findFirst({ orderBy: { startTime: 'asc' } });
  alice = await prisma.user.create({ data: { email: `test-aord-${RUN}-alice@example.com`, passwordHash: 'x', fullName: `Alice Nguyen ${RUN}` } });
  bob = await prisma.user.create({ data: { email: `test-aord-${RUN}-bob@example.com`, passwordHash: 'x', fullName: `Bob Tran ${RUN}` } });
  orders.refund = await makeOrder(alice, { status: 'REFUND_PENDING', paidAt: new Date() });
  orders.paid = await makeOrder(alice, { status: 'PAID', paidAt: new Date() });
  orders.pending = await makeOrder(bob, { status: 'PENDING' });
  orders.old = await makeOrder(bob, { status: 'CANCELLED', createdAt: new Date(Date.now() - 30 * 86_400_000) });
  await prisma.orderSeat.create({ data: { orderId: orders.paid.id, seatId: (await prisma.seat.findFirst({ where: { roomId: showtime.roomId } })).id, seatLabel: 'Z9', seatType: 'STANDARD', price: 100_000 } });
  await prisma.payment.create({ data: { orderId: orders.refund.id, txnRef: `${orders.refund.code}-1`, amount: 100_000, status: 'SUCCESS', bankCode: 'NCB', providerTxnNo: '999', responseCode: '00', paidAt: new Date() } });
});

after(async () => {
  const ids = [alice.id, bob.id];
  await prisma.payment.deleteMany({ where: { order: { userId: { in: ids } } } });
  await prisma.order.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

const list = (extra = {}) => svc.listAdminOrders({ q: String(RUN), page: 1, pageSize: 50, ...extra }); // q=RUN: chỉ thấy đơn của test này

test('danh sách: tìm theo email/họ tên (không phân biệt hoa-thường) và theo mã đơn; mới nhất trước', async () => {
  const all = await list();
  assert.equal(all.meta.total, 4);
  assert.equal(all.items[all.items.length - 1].id, orders.old.id); // cũ nhất ở cuối
  assert.equal((await svc.listAdminOrders({ q: `ALICE NGUYEN ${RUN}`, page: 1, pageSize: 50 })).meta.total, 2);
  assert.equal((await svc.listAdminOrders({ q: `bob-tran-no`, page: 1, pageSize: 50 })).meta.total, 0);
  const byCode = await svc.listAdminOrders({ q: orders.pending.code.toLowerCase(), page: 1, pageSize: 50 });
  assert.deepEqual(byCode.items.map((o) => o.id), [orders.pending.id]);
  const row = all.items.find((o) => o.id === orders.paid.id);
  assert.deepEqual(row.seatLabels, ['Z9']);
  assert.equal(row.user.email, alice.email);
  assert.ok(row.showtime.movieTitle && row.showtime.cinemaName);
});

test('danh sách: lọc theo trạng thái, khoảng ngày (giờ VN), phân trang', async () => {
  assert.deepEqual((await list({ status: 'REFUND_PENDING' })).items.map((o) => o.id), [orders.refund.id]);
  const today = new Date(Date.now() + 7 * 60 * minute).toISOString().slice(0, 10);
  const recent = await list({ from: today, to: today }); // đơn tạo hôm nay: loại đơn 30 ngày trước
  assert.equal(recent.meta.total, 3);
  assert.ok(recent.items.every((o) => o.id !== orders.old.id));
  const page2 = await list({ page: 2, pageSize: 3 });
  assert.equal(page2.items.length, 1);
  assert.equal(page2.meta.totalPages, 2);
});

test('chi tiết: có khách hàng, giao dịch (payments[]) và cấu trúc Order; id lạ -> NOT_FOUND', async () => {
  const d = await svc.getAdminOrder({ orderId: orders.refund.id });
  assert.equal(d.status, 'REFUND_PENDING');
  assert.equal(d.user.email, alice.email);
  assert.equal(d.payments.length, 1);
  assert.deepEqual([d.payments[0].txnRef, d.payments[0].amount, d.payments[0].status], [`${orders.refund.code}-1`, 100_000, 'SUCCESS']);
  assert.ok(!('rawData' in d.payments[0])); // không trả dữ liệu thô của cổng thanh toán
  assert.equal(await failCode(svc.getAdminOrder({ orderId: '00000000-0000-4000-8000-000000000000' })), 'NOT_FOUND');
});

test('⭐ hoàn tiền: chỉ REFUND_PENDING -> REFUNDED; đơn khác và bấm lần hai bị từ chối, trạng thái không đổi', async () => {
  assert.equal(await failCode(svc.refundOrder({ orderId: orders.paid.id })), 'ORDER_NOT_PENDING'); // đã trả tiền bình thường: KHÔNG hoàn
  assert.equal(await failCode(svc.refundOrder({ orderId: orders.pending.id })), 'ORDER_NOT_PENDING');
  assert.equal((await prisma.order.findUnique({ where: { id: orders.paid.id } })).status, 'PAID');
  assert.equal(await failCode(svc.refundOrder({ orderId: '00000000-0000-4000-8000-000000000000' })), 'NOT_FOUND');

  assert.equal((await svc.refundOrder({ orderId: orders.refund.id })).status, 'REFUNDED');
  assert.equal(await failCode(svc.refundOrder({ orderId: orders.refund.id })), 'ORDER_NOT_PENDING'); // bấm lần hai
});

test('⭐ 5 admin bấm hoàn tiền CÙNG MỘT đơn cùng lúc: đúng 1 người thành công', async () => {
  const o = await makeOrder(alice, { status: 'REFUND_PENDING', paidAt: new Date() });
  const results = await Promise.all(Array.from({ length: 5 }, () => svc.refundOrder({ orderId: o.id }).then(() => 'ok', (e) => e.code)));
  assert.equal(results.filter((r) => r === 'ok').length, 1);
  assert.equal(results.filter((r) => r === 'ORDER_NOT_PENDING').length, 4);
});

test('đơn đã hoàn tiền (hoặc chờ hoàn) không check-in được', async () => {
  const t = await lookupTicket({ code: orders.refund.code });
  assert.deepEqual([t.canCheckIn, t.reason], [false, 'NOT_PAID']);
});

test('HTTP: không token 401; USER và STAFF 403; ADMIN xem được và hoàn tiền; bộ lọc sai 400', async () => {
  const o = await makeOrder(bob, { status: 'REFUND_PENDING', paidAt: new Date() });
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}/api/v1/admin/orders`;
  const hdr = (role) => ({ headers: { Authorization: `Bearer ${signAccessToken({ id: alice.id, role })}` } });
  try {
    assert.equal((await fetch(base)).status, 401);
    assert.equal((await fetch(base, hdr('USER'))).status, 403);
    assert.equal((await fetch(`${base}/${o.id}`, hdr('STAFF'))).status, 403);
    assert.equal((await fetch(`${base}/${o.id}/refund`, { method: 'PATCH', ...hdr('STAFF') })).status, 403);

    const found = await (await fetch(`${base}?status=REFUND_PENDING&q=${RUN}`, hdr('ADMIN'))).json();
    assert.ok(found.data.some((x) => x.id === o.id));
    assert.equal((await (await fetch(`${base}/${o.id}`, hdr('ADMIN'))).json()).data.user.email, bob.email);
    const done = await fetch(`${base}/${o.id}/refund`, { method: 'PATCH', ...hdr('ADMIN') });
    assert.equal(done.status, 200);
    assert.equal((await done.json()).data.status, 'REFUNDED');
    const again = await fetch(`${base}/${o.id}/refund`, { method: 'PATCH', ...hdr('ADMIN') });
    assert.equal(again.status, 409);
    assert.equal((await again.json()).error.code, 'ORDER_NOT_PENDING');
    assert.equal((await fetch(`${base}?status=XYZ&from=1-1`, hdr('ADMIN'))).status, 400);
  } finally {
    server.close();
  }
});
