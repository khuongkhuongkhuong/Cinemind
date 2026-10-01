// Vòng đời đơn: hủy (BR-07, BR-08) và dọn đơn hết hạn (03-database mục 5.6).
// Cần dữ liệu mẫu: chạy `npm run db:seed` trước.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { prisma } = await import('../src/config/prisma.js');
const { holdSeats, cancelOrder, expirePendingOrders } = await import('../src/services/booking.service.js');
const { default: app } = await import('../src/app.js');
const { signAccessToken } = await import('../src/lib/jwt.js');

const minute = 60_000;
const RUN = Date.now();
let showtime;
let seats;
const users = [];

const seat = (label) => seats.find((s) => `${s.row}${s.number}` === label);
const hold = (user, ...labels) =>
  holdSeats({ userId: user.id, showtimeId: showtime.id, seatIds: labels.map((l) => seat(l).id) });
const failCode = (promise) => promise.then(() => null, (e) => e.code);
const lockCount = (orderId) => prisma.seatLock.count({ where: { orderId } });
const statusOf = async (orderId) => (await prisma.order.findUnique({ where: { id: orderId } })).status;
const makeUsers = async (n) => {
  const created = [];
  for (let i = 0; i < n; i++) {
    created.push(await prisma.user.create({
      data: { email: `test-life-${RUN}-${users.length + i}@example.com`, passwordHash: 'x', fullName: 'Test' },
    }));
  }
  users.push(...created);
  return created;
};
// Đưa một đơn về trạng thái "đã quá hạn" mà không phải chờ 10 phút thật.
const makeExpired = (orderId) =>
  prisma.$transaction([
    prisma.order.update({ where: { id: orderId }, data: { expiresAt: new Date(Date.now() - minute) } }),
    prisma.seatLock.updateMany({ where: { orderId }, data: { expiresAt: new Date(Date.now() - minute) } }),
  ]);

before(async () => {
  // Suất XA thứ hai (skip 1) để không đụng test booking dùng suất xa nhất, chạy song song.
  [showtime] = await prisma.showtime.findMany({ where: { status: 'OPEN' }, orderBy: { startTime: 'desc' }, skip: 1, take: 1 });
  seats = await prisma.seat.findMany({ where: { roomId: showtime.roomId } });
});

after(async () => {
  const userIds = users.map((u) => u.id);
  await prisma.order.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

test('hủy đơn PENDING: -> CANCELLED, nhả ghế, người khác giữ được ngay (BR-07)', async () => {
  const [a, b] = await makeUsers(2);
  const order = await hold(a, 'A1', 'A2');
  const result = await cancelOrder({ userId: a.id, orderId: order.id });
  assert.equal(result.status, 'CANCELLED');
  assert.equal(await lockCount(order.id), 0);
  assert.equal((await hold(b, 'A1', 'A2')).status, 'PENDING');
});

test('hủy đơn của người khác -> FORBIDDEN; đơn không tồn tại -> NOT_FOUND', async () => {
  const [owner, stranger] = await makeUsers(2);
  const order = await hold(owner, 'B1');
  assert.equal(await failCode(cancelOrder({ userId: stranger.id, orderId: order.id })), 'FORBIDDEN');
  assert.equal(await statusOf(order.id), 'PENDING'); // không bị hủy nhầm
  const missing = '00000000-0000-4000-8000-000000000000';
  assert.equal(await failCode(cancelOrder({ userId: owner.id, orderId: missing })), 'NOT_FOUND');
});

test('hủy lần hai và hủy đơn đã thanh toán -> ORDER_NOT_PENDING (BR-08); ghế đã bán KHÔNG bị nhả', async () => {
  const [u] = await makeUsers(1);
  const order = await hold(u, 'C1');
  await cancelOrder({ userId: u.id, orderId: order.id });
  assert.equal(await failCode(cancelOrder({ userId: u.id, orderId: order.id })), 'ORDER_NOT_PENDING');

  const paid = await hold(u, 'C3');
  await prisma.order.update({ where: { id: paid.id }, data: { status: 'PAID', paidAt: new Date() } });
  await prisma.seatLock.updateMany({ where: { orderId: paid.id }, data: { status: 'SOLD', expiresAt: null } });
  assert.equal(await failCode(cancelOrder({ userId: u.id, orderId: paid.id })), 'ORDER_NOT_PENDING');
  assert.equal(await lockCount(paid.id), 1);
});

test('hủy đơn đã quá hạn giữ ghế -> ORDER_EXPIRED', async () => {
  const [u] = await makeUsers(1);
  const order = await hold(u, 'D1');
  await makeExpired(order.id);
  // test file khác có thể quét cron giữa chừng (PENDING quá hạn -> EXPIRED): cả hai mã đều là từ chối đúng
  assert.ok(['ORDER_EXPIRED', 'ORDER_NOT_PENDING'].includes(await failCode(cancelOrder({ userId: u.id, orderId: order.id }))));
});

test('⭐ hủy đơn đồng thời với "IPN" xác nhận thanh toán: không bao giờ vừa PAID vừa mất ghế', async () => {
  const users2 = await makeUsers(20);
  for (const [i, u] of users2.entries()) {
    const label = `${'EFG'[i % 3]}${Math.floor(i / 3) + 1}`; // mỗi người một ghế khác nhau
    const order = await hold(u, label);
    const [cancelResult] = await Promise.all([
      failCode(cancelOrder({ userId: u.id, orderId: order.id })),
      // mô phỏng IPN: chuyển sang PAID CÓ ĐIỀU KIỆN status = PENDING (đúng cách confirmPayment sẽ làm)
      prisma.order.updateMany({ where: { id: order.id, status: 'PENDING' }, data: { status: 'PAID' } }),
    ]);
    const status = await statusOf(order.id);
    if (status === 'PAID') {
      assert.equal(cancelResult, 'ORDER_NOT_PENDING'); // IPN thắng -> hủy phải bị từ chối
      assert.equal(await lockCount(order.id), 1); // ghế vẫn còn giữ
    } else {
      assert.equal(status, 'CANCELLED'); // hủy thắng
      assert.equal(await lockCount(order.id), 0);
    }
  }
});

test('expirePendingOrders: đơn quá hạn -> EXPIRED + nhả ghế; đơn còn hạn và đơn PAID giữ nguyên', async () => {
  const [a, b, c] = await makeUsers(3);
  const stale = await hold(a, 'A5');
  const fresh = await hold(b, 'A6');
  const paid = await hold(c, 'A7');
  await prisma.order.update({ where: { id: paid.id }, data: { status: 'PAID', paidAt: new Date() } });
  await prisma.seatLock.updateMany({ where: { orderId: paid.id }, data: { status: 'SOLD', expiresAt: null } });
  await makeExpired(stale.id);
  await prisma.order.update({ where: { id: paid.id }, data: { expiresAt: new Date(Date.now() - minute) } }); // PAID nhưng "quá hạn"

  const count = await expirePendingOrders();
  assert.ok(count >= 1);

  assert.equal(await statusOf(stale.id), 'EXPIRED');
  assert.equal(await lockCount(stale.id), 0);
  assert.equal(await statusOf(fresh.id), 'PENDING');
  assert.equal(await lockCount(fresh.id), 1);
  assert.equal(await statusOf(paid.id), 'PAID'); // KHÔNG bị chuyển EXPIRED
  assert.equal(await lockCount(paid.id), 1); // ghế đã bán KHÔNG bị nhả
});

test('POST /orders/:id/cancel qua HTTP', async () => {
  const [u] = await makeUsers(1);
  const order = await hold(u, 'B5');
  const server = app.listen(0);
  try {
    const token = signAccessToken({ id: u.id, role: 'USER' });
    const res = await fetch(`http://localhost:${server.address().port}/api/v1/orders/${order.id}/cancel`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).data.status, 'CANCELLED');
  } finally {
    server.close();
  }
});
