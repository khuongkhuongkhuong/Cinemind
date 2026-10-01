// "Vé của tôi": danh sách đơn của mình + chi tiết theo mã kèm QR.
// Cần dữ liệu mẫu: chạy `npm run db:seed` trước.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { prisma } = await import('../src/config/prisma.js');
const { holdSeats, listMyOrders, getMyOrderByCode } = await import('../src/services/booking.service.js');
const { default: app } = await import('../src/app.js');
const { signAccessToken } = await import('../src/lib/jwt.js');

const RUN = Date.now();
let showtime;
let seats;
const users = [];

const seat = (label) => seats.find((s) => `${s.row}${s.number}` === label);
const failCode = (promise) => promise.then(() => null, (e) => e.code);
const makeUser = async () => {
  const u = await prisma.user.create({ data: { email: `test-me-${RUN}-${users.length}@example.com`, passwordHash: 'x', fullName: 'Test' } });
  users.push(u);
  return u;
};
const hold = (user, ...labels) =>
  holdSeats({ userId: user.id, showtimeId: showtime.id, seatIds: labels.map((l) => seat(l).id) });
const markPaid = (orderId) => prisma.order.update({ where: { id: orderId }, data: { status: 'PAID', paidAt: new Date() } });

let alice;
let bob;
let paid1; let paid2; let pending;

before(async () => {
  [showtime] = await prisma.showtime.findMany({ where: { status: 'OPEN', startTime: { lt: new Date(Date.now() + 30 * 86_400_000) } }, orderBy: { startTime: 'desc' }, skip: 3, take: 1 });
  seats = await prisma.seat.findMany({ where: { roomId: showtime.roomId } });
  alice = await makeUser();
  bob = await makeUser();
  paid1 = await hold(alice, 'A1', 'A2'); await markPaid(paid1.id); // đơn PAID không bị BR-03 hủy
  paid2 = await hold(alice, 'B1'); await markPaid(paid2.id);
  pending = await hold(alice, 'C1');
  await markPaid((await hold(bob, 'D1')).id); // vé của người khác
});

after(async () => {
  const userIds = users.map((u) => u.id);
  await prisma.order.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

test('mặc định chỉ trả đơn PAID của CHÍNH MÌNH, mới nhất trước, đúng hình dạng OrderSummary', async () => {
  const { items, meta } = await listMyOrders({ userId: alice.id, page: 1, pageSize: 20 });
  assert.deepEqual(items.map((o) => o.id), [paid2.id, paid1.id]); // không có đơn PENDING, không có vé của Bob
  assert.equal(meta.total, 2);
  const o = items[1];
  assert.deepEqual(o.seatLabels, ['A1', 'A2']);
  assert.equal(o.total, paid1.total);
  assert.ok(o.showtime.movie.title && o.showtime.cinema.name && o.showtime.room.name);
  assert.ok(!('seats' in o)); // OrderSummary gọn, không có mảng seats của Order
});

test('lọc theo status và phân trang', async () => {
  const pend = await listMyOrders({ userId: alice.id, status: 'PENDING', page: 1, pageSize: 20 });
  assert.deepEqual(pend.items.map((o) => o.id), [pending.id]);
  const page1 = await listMyOrders({ userId: alice.id, page: 1, pageSize: 1 });
  const page2 = await listMyOrders({ userId: alice.id, page: 2, pageSize: 1 });
  assert.equal(page1.items.length, 1);
  assert.equal(page1.meta.totalPages, 2);
  assert.notEqual(page1.items[0].id, page2.items[0].id);
});

test('chi tiết theo mã: PAID có qrContent; PENDING thì qrContent = null; mã không phân biệt hoa/thường', async () => {
  const ticket = await getMyOrderByCode({ userId: alice.id, code: paid1.code.toLowerCase() });
  assert.equal(ticket.qrContent, `CINEMIND:${paid1.code}`);
  assert.equal(ticket.status, 'PAID');
  assert.deepEqual(ticket.seats.map((s) => s.label), ['A1', 'A2']);
  assert.equal((await getMyOrderByCode({ userId: alice.id, code: pending.code })).qrContent, null);
});

test('⭐ mã vé của người khác -> NOT_FOUND (không lộ là mã có tồn tại)', async () => {
  assert.equal(await failCode(getMyOrderByCode({ userId: bob.id, code: paid1.code })), 'NOT_FOUND');
  assert.equal(await failCode(getMyOrderByCode({ userId: bob.id, code: 'KHONGCO1' })), 'NOT_FOUND');
});

test('HTTP: cần đăng nhập; userId lấy từ token chứ không từ query', async () => {
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}/api/v1/me`;
  const bearer = (u) => ({ headers: { Authorization: `Bearer ${signAccessToken({ id: u.id, role: 'USER' })}` } });
  try {
    assert.equal((await fetch(`${base}/orders`)).status, 401);
    // Bob cố đọc vé của Alice bằng cách nhét userId vào query -> bị bỏ qua, chỉ thấy vé của Bob
    const res = await (await fetch(`${base}/orders?userId=${alice.id}`, bearer(bob))).json();
    assert.equal(res.data.length, 1);
    assert.notEqual(res.data[0].id, paid1.id);
    assert.equal(res.meta.total, 1);

    const detail = await (await fetch(`${base}/orders/${paid1.code}`, bearer(alice))).json();
    assert.equal(detail.data.qrContent, `CINEMIND:${paid1.code}`);
    assert.equal((await fetch(`${base}/orders/${paid1.code}`, bearer(bob))).status, 404);
    assert.equal((await fetch(`${base}/orders?status=XYZ`, bearer(alice))).status, 400);
  } finally {
    server.close();
  }
});
