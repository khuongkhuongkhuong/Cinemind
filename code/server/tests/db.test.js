// Tầng (truy vấn nội bộ) (docs/04 mục 5.2): transaction dùng chung, tham số cuối `db` (truyền tx), lỗi CSDL đi xuyên qua (truy vấn nội bộ),
// cập nhật có điều kiện trả count. Cần dữ liệu mẫu: chạy `npm run db:seed` trước.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

process.env.NODE_ENV = 'test';
const { prisma } = await import('../src/config/prisma.js');
const { runInTransaction } = await import('../src/config/prisma.js');
const { lockRoom } = await import('../src/services/showtime.service.js');
const userSvc = await import('../src/services/user.service.js');
const { createOrder } = await import('./helpers/orders.js');
const authSvc = await import('../src/services/auth.service.js');
const { findPriceRule, getAllSurcharges } = await import('../src/services/pricing.service.js');

const RUN = Date.now();
const email = (tag) => `test-dao-${RUN}-${tag}@example.com`;
const hash = (s) => createHash('sha256').update(s).digest('hex');
let user;

before(async () => {
  user = await userSvc.createUser({ email: email('main'), passwordHash: 'x', fullName: 'Test (truy vấn nội bộ)', phone: null });
});
after(async () => {
  await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
  await prisma.user.deleteMany({ where: { email: { startsWith: `test-dao-${RUN}` } } });
  await prisma.$disconnect();
});

test('runInTransaction: mọi bước dùng cùng tx; ném lỗi thì ROLLBACK toàn bộ (kể cả bước đã thành công trước đó)', async () => {
  await assert.rejects(() => runInTransaction(async (tx) => {
    await userSvc.createUser({ email: email('rb'), passwordHash: 'x', fullName: 'Sẽ bị hủy', phone: null }, tx);
    assert.ok(await userSvc.findUserByEmail(email('rb'), tx), 'trong transaction phải thấy dòng vừa ghi');
    assert.equal(await userSvc.findUserByEmail(email('rb')), null, 'ngoài transaction chưa thấy (chưa commit)');
    throw new Error('hủy giữa chừng');
  }), /hủy giữa chừng/);
  assert.equal(await userSvc.findUserByEmail(email('rb')), null);
});

test('runInTransaction: commit khi không lỗi và trả về giá trị của work', async () => {
  const out = await runInTransaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { fullName: 'Đã đổi tên' } });
    return 42;
  });
  assert.equal(out, 42);
  assert.equal((await userSvc.getUserById(user.id)).fullName, 'Đã đổi tên');
});

test('⭐ lỗi CSDL đi xuyên qua (truy vấn nội bộ) (truy vấn nội bộ không ném AppError): trùng email -> P2002 để service dịch', async () => {
  const err = await userSvc.createUser({ email: email('main'), passwordHash: 'x', fullName: 'Trùng', phone: null }).then(() => null, (e) => e);
  assert.equal(err.code, 'P2002');
  assert.equal(err.name === 'AppError', false);
});

test('⭐ lockRoom: hai transaction cùng phòng xếp hàng (cái sau chờ cái trước commit); khác phòng thì không chờ nhau', async () => {
  const order = [];
  // Cùng thời gian chờ như service (nhóm kết nối có thể đầy khi cả bộ test chạy song song; mặc định chỉ chờ 2 giây).
  const opts = { maxWait: 10_000, timeout: 15_000 };
  let releaseFirst;
  const gate = new Promise((r) => { releaseFirst = r; });
  const first = runInTransaction(async (tx) => {
    await lockRoom(tx, 'room-A');
    order.push('first-locked');
    await gate;
    order.push('first-done');
  }, opts);
  await new Promise((r) => setTimeout(r, 100));
  const second = runInTransaction(async (tx) => { await lockRoom(tx, 'room-A'); order.push('second-locked'); }, opts);
  const other = runInTransaction(async (tx) => { await lockRoom(tx, 'room-B'); order.push('other-locked'); }, opts);
  await other; // phòng khác không bị chặn
  await new Promise((r) => setTimeout(r, 150));
  assert.deepEqual(order, ['first-locked', 'other-locked']); // second vẫn đang chờ
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first-locked', 'other-locked', 'first-done', 'second-locked']);
});

test('⭐ revokeIfValid: cập nhật có điều kiện trả count — 10 lần SONG SONG chỉ 1 lần thu hồi được; token hết hạn / đã thu hồi -> 0', async () => {
  await authSvc.insertRefreshToken({ userId: user.id, tokenHash: hash('t1'), expiresAt: new Date(Date.now() + 60_000) });
  const counts = await Promise.all(Array.from({ length: 10 }, () => authSvc.revokeIfValid({ tokenHash: hash('t1'), now: new Date() })));
  assert.equal(counts.filter((c) => c === 1).length, 1);
  assert.equal(counts.filter((c) => c === 0).length, 9);
  assert.equal(await authSvc.revokeIfValid({ tokenHash: hash('t1'), now: new Date() }), 0);

  await authSvc.insertRefreshToken({ userId: user.id, tokenHash: hash('t2'), expiresAt: new Date(Date.now() - 1000) });
  assert.equal(await authSvc.revokeIfValid({ tokenHash: hash('t2'), now: new Date() }), 0); // hết hạn
  assert.equal(await authSvc.revokeIfValid({ tokenHash: hash('khong-co'), now: new Date() }), 0);
});

test('refreshToken (truy vấn nội bộ): findToken (KHÔNG kèm user — user thuộc user.service); revokeToken / revokeAllOfUser chỉ đụng token còn hiệu lực của đúng user', async () => {
  const other = await userSvc.createUser({ email: email('other'), passwordHash: 'x', fullName: 'Người khác', phone: null });
  const future = new Date(Date.now() + 60_000);
  await authSvc.insertRefreshToken({ userId: user.id, tokenHash: hash('a'), expiresAt: future });
  await authSvc.insertRefreshToken({ userId: user.id, tokenHash: hash('b'), expiresAt: future });
  await authSvc.insertRefreshToken({ userId: other.id, tokenHash: hash('c'), expiresAt: future });

  const found = await authSvc.findToken(hash('a'));
  assert.equal(found.userId, user.id);
  assert.equal('user' in found, false);
  assert.equal(await authSvc.findToken(hash('khong-co')), null);
  assert.equal(await authSvc.revokeToken({ tokenHash: hash('a'), now: new Date() }), 1);
  assert.equal(await authSvc.revokeToken({ tokenHash: hash('a'), now: new Date() }), 0); // đã thu hồi
  // Còn chưa thu hồi của user này: 'b' và 't2' (token hết hạn ở test trước, revokedAt vẫn null). 'a' và 't1' đã thu hồi rồi nên không tính.
  assert.equal(await authSvc.revokeAllOfUser({ userId: user.id, now: new Date() }), 2);
  assert.equal(await authSvc.revokeAllOfUser({ userId: user.id, now: new Date() }), 0); // gọi lại: không còn gì
  assert.equal((await authSvc.findToken(hash('c'))).revokedAt, null); // token của người khác nguyên vẹn
});

test('user / priceRule / surcharge (truy vấn nội bộ): đọc đúng, trả null khi không có', async () => {
  assert.equal((await userSvc.findUserByEmail(email('main'))).id, user.id);
  assert.deepEqual(await userSvc.getAccountState({ userId: user.id }), { role: 'USER', isActive: true });
  assert.equal(await userSvc.getAccountState({ userId: '00000000-0000-4000-8000-000000000000' }), null);
  assert.equal(await userSvc.getUserById('00000000-0000-4000-8000-000000000000'), null);
  await userSvc.setPassword({ userId: user.id, passwordHash: 'hash-moi' });
  assert.equal((await userSvc.getUserById(user.id)).passwordHash, 'hash-moi');

  const rule = await findPriceRule({ format: 'F2D', dayType: 'WEEKDAY' });
  assert.equal(rule.basePrice, 75_000);
  const surcharges = await getAllSurcharges();
  assert.deepEqual(surcharges.map((s) => s.seatType).sort(), ['COUPLE', 'STANDARD', 'VIP']);
});

// ------------------------------------------------------------------ order.dao (soát vé) ------------------------------------------------------------------

test('⭐ order.dao: checkInIfNotUsed trả count — 10 lần SONG SONG chỉ 1 lần thành công; đơn chưa PAID / đã dùng -> 0; findOrderByCode kèm trạng thái suất', async () => {
  const orderSvc = await import('../src/services/order.service.js');
  const showtime = await prisma.showtime.findFirst({ where: { status: 'OPEN', room: { name: { startsWith: 'Phòng ' }, seats: { some: {} } } } });
  const mk = (tag, status) => createOrder({
    data: { code: `D${RUN}${process.pid}${tag}`.slice(-10), userId: user.id, showtimeId: showtime.id, status, paidAt: status === 'PAID' ? new Date() : null, expiresAt: new Date(), seatTotal: 1, total: 1 },
  });
  const paid = await mk('p', 'PAID');
  const pending = await mk('n', 'PENDING');
  try {
    const found = await orderSvc.findOrderByCode(paid.code);
    assert.equal(found.id, paid.id);
    assert.equal(found.tickets[0].showtime.status, 'OPEN'); // suất nằm ở vé; trạng thái suất cần cho luật check-in
    assert.ok(found.tickets[0].showtime.movie.title && Array.isArray(found.tickets));
    assert.equal(await orderSvc.findOrderByCode('KHONGCOMA'), null);
    assert.equal((await orderSvc.getOrderById(paid.id)).code, paid.code);
    assert.equal((await orderSvc.getOrderDetail(paid.id)).tickets[0].showtime.room.cinema.name.length > 0, true);

    const now = new Date();
    const counts = await Promise.all(Array.from({ length: 10 }, () => orderSvc.checkInIfNotUsed({ orderId: paid.id, staffId: user.id, now })));
    assert.equal(counts.filter((c) => c === 1).length, 1);
    assert.equal(counts.filter((c) => c === 0).length, 9);
    const after = await orderSvc.getOrderById(paid.id);
    assert.equal(after.checkedInById, user.id);
    assert.equal(await orderSvc.checkInIfNotUsed({ orderId: pending.id, staffId: user.id, now }), 0); // chưa thanh toán
  } finally {
    await prisma.order.deleteMany({ where: { id: { in: [paid.id, pending.id] } } });
  }
});
