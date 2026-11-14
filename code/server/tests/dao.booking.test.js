// DAO của đặt vé (order / seatLock / orderCombo / combo / seat). Mỗi hàm là MỘT thao tác truy vấn: test kiểm ĐÚNG điều kiện của câu lệnh,
// đặc biệt các câu ⭐ (chèn khóa ghế, cập nhật có điều kiện). Cần dữ liệu mẫu: chạy `npm run db:seed` trước.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { prisma } = await import('../src/config/prisma.js');
const { runInTransaction } = await import('../src/dao/transaction.js');
const orderDao = await import('../src/dao/order.dao.js');
const lockDao = await import('../src/dao/seatLock.dao.js');
const seatDao = await import('../src/dao/seat.dao.js');
const showtimeDao = await import('../src/dao/showtime.dao.js');
const comboDao = await import('../src/dao/combo.dao.js');
const orderComboDao = await import('../src/dao/orderCombo.dao.js');

const minute = 60_000;
const DAY = 24 * 60 * minute;
const RUN = Date.now();
let room; let showtime; let user; let other; let seats; let n = 0;
const seatId = (label) => seats[label].id;

before(async () => {
  const cinema = await prisma.cinema.findFirst({ where: { name: { startsWith: 'Cinemind' }, isActive: true }, orderBy: { name: 'asc' } });
  const movie = await prisma.movie.findFirst({ where: { status: 'NOW_SHOWING', description: { not: 'Mô tả thử' } } });
  room = await prisma.room.create({ data: { cinemaId: cinema.id, name: `TestRoom-${RUN}-daobk` } });
  await prisma.seat.createMany({ data: ['A1', 'A2', 'A3', 'A4', 'A5'].map((l) => ({ roomId: room.id, row: l[0], number: Number(l[1]), type: 'STANDARD' })) });
  seats = Object.fromEntries((await prisma.seat.findMany({ where: { roomId: room.id } })).map((s) => [`${s.row}${s.number}`, s]));
  const start = new Date(Math.ceil((Date.now() + 100 * DAY) / (60 * minute)) * 60 * minute);
  showtime = await showtimeDao.insertShowtime({ movieId: movie.id, roomId: room.id, startTime: start, endTime: new Date(start.getTime() + 2 * 60 * minute), format: 'F2D', audio: 'SUBTITLE', basePrice: 80_000 });
  user = await prisma.user.create({ data: { email: `test-daobk-${RUN}-a@example.com`, passwordHash: 'x', fullName: 'Test A' } });
  other = await prisma.user.create({ data: { email: `test-daobk-${RUN}-b@example.com`, passwordHash: 'x', fullName: 'Test B' } });
});
after(async () => {
  await prisma.order.deleteMany({ where: { userId: { in: [user.id, other.id] } } }); // SeatLock + OrderCombo xóa theo (cascade)
  await prisma.combo.deleteMany({ where: { name: { startsWith: `TestCombo-${RUN}` } } });
  await prisma.showtime.deleteMany({ where: { roomId: room.id } });
  await prisma.seat.deleteMany({ where: { roomId: room.id } });
  await prisma.room.delete({ where: { id: room.id } });
  await prisma.user.deleteMany({ where: { id: { in: [user.id, other.id] } } });
  await prisma.$disconnect();
});

const future = () => new Date(Date.now() + 10 * minute);
const past = () => new Date(Date.now() - minute);
/** Tạo đơn qua chính DAO (kiểm luôn insertOrderWithTickets). */
const mkOrder = (who, { status, expiresAt = future(), labels = ['A1'] } = {}) => orderDao.insertOrderWithTickets({
  code: `DB${RUN}${process.pid}${n++}`.slice(-10), userId: who.id, showtimeId: showtime.id, source: 'WEB', expiresAt, seatTotal: 100_000, total: 100_000,
  tickets: labels.map((l) => ({ seatId: seatId(l), seatLabel: l, seatType: 'STANDARD', price: 50_000 })),
}).then(async (o) => (status ? prisma.order.update({ where: { id: o.id }, data: { status, paidAt: status === 'PAID' ? new Date() : null } }) : o));

test('insertOrderWithTickets: tạo đơn + các dòng vé với GIÁ ĐÃ CHỐT; mặc định PENDING; getOrderDetail / getOrderOwner / getOrderStatus / getOrderDetailByCode đọc lại', async () => {
  const o = await mkOrder(user, { labels: ['A1', 'A2'] });
  assert.equal(o.status, 'PENDING');
  assert.equal(o.source, 'WEB');
  const detail = await orderDao.getOrderDetail(o.id);
  assert.deepEqual(detail.tickets.map((s) => [s.seatLabel, s.price]), [['A1', 50_000], ['A2', 50_000]]);
  assert.equal(detail.showtime.id, showtime.id);
  assert.deepEqual(await orderDao.getOrderOwner(o.id), { userId: user.id });
  assert.deepEqual(await orderDao.getOrderStatus(o.id), { status: 'PENDING' });
  assert.equal((await orderDao.getOrderDetailByCode(o.code)).id, o.id);
  for (const fn of ['getOrderDetail', 'getOrderOwner', 'getOrderStatus', 'getOrderDetailByCode']) {
    assert.equal(await orderDao[fn]('00000000-0000-4000-8000-000000000000'), null, fn);
  }
  assert.equal(await orderDao.getOrderDetailByCode('KHONGCOMA'), null);
});

test('⭐ insertHeldLocks: chèn TẤT CẢ trong một câu; trùng khóa chính (showtimeId, seatId) -> lỗi P2002 đi xuyên DAO và KHÔNG ghế nào được chèn (tất cả hoặc không); không bỏ qua ghế trùng', async () => {
  const a = await mkOrder(user, { labels: ['A1'] });
  const b = await mkOrder(other, { labels: ['A2'] });
  await lockDao.insertHeldLocks({ showtimeId: showtime.id, seatIds: [seatId('A2')], orderId: a.id, expiresAt: future() });

  // b muốn A1 + A2 nhưng A2 đã bị a giữ: phải thất bại và A1 cũng KHÔNG được giữ.
  const err = await lockDao.insertHeldLocks({ showtimeId: showtime.id, seatIds: [seatId('A1'), seatId('A2')], orderId: b.id, expiresAt: future() }).then(() => null, (e) => e);
  assert.equal(err.code, 'P2002');
  assert.equal(await prisma.seatLock.count({ where: { orderId: b.id } }), 0);
  assert.equal(await prisma.seatLock.count({ where: { showtimeId: showtime.id } }), 1); // chỉ còn khóa của a
  await lockDao.deleteLocksOfOrder(a.id);
});

test('⭐ insertHeldLocks: 20 yêu cầu SONG SONG cho cùng một ghế -> đúng 1 thắng (khóa chính là trọng tài), 19 nhận P2002', async () => {
  const orders = await Promise.all(Array.from({ length: 20 }, (_, i) => mkOrder(i % 2 ? user : other, { labels: ['A3'] })));
  const results = await Promise.allSettled(orders.map((o) => lockDao.insertHeldLocks({ showtimeId: showtime.id, seatIds: [seatId('A3')], orderId: o.id, expiresAt: future() })));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.ok(results.filter((r) => r.status === 'rejected').every((r) => r.reason.code === 'P2002'));
  assert.equal(await prisma.seatLock.count({ where: { showtimeId: showtime.id, seatId: seatId('A3') } }), 1);
  await prisma.seatLock.deleteMany({ where: { showtimeId: showtime.id } });
});

test('⭐ cùng tx: bước ghi trong transaction không thấy ngoài transaction và bị ROLLBACK khi lỗi (đơn + khóa ghế cùng biến mất)', async () => {
  const before = await prisma.order.count({ where: { userId: user.id } });
  await assert.rejects(() => runInTransaction(async (tx) => {
    const o = await orderDao.insertOrderWithTickets({
      code: `TX${RUN}${process.pid}`.slice(-10), userId: user.id, showtimeId: showtime.id, source: 'AI_CHAT', expiresAt: future(), seatTotal: 1, total: 1,
      tickets: [{ seatId: seatId('A4'), seatLabel: 'A4', seatType: 'STANDARD', price: 1 }],
    }, tx);
    await lockDao.insertHeldLocks({ showtimeId: showtime.id, seatIds: [seatId('A4')], orderId: o.id, expiresAt: future() }, tx);
    assert.equal(await prisma.order.count({ where: { id: o.id } }), 0, 'ngoài transaction chưa thấy đơn');
    throw new Error('lỗi giữa chừng');
  }), /lỗi giữa chừng/);
  assert.equal(await prisma.order.count({ where: { userId: user.id } }), before);
  assert.equal(await prisma.seatLock.count({ where: { showtimeId: showtime.id, seatId: seatId('A4') } }), 0);
});

test('deleteExpiredHeldLocks chỉ xóa lượt HELD QUÁ HẠN của đúng các ghế đã cho (không đụng lượt còn hạn, ghế SOLD, ghế khác, suất khác)', async () => {
  const o = await mkOrder(user, { labels: ['A1', 'A2', 'A3', 'A4'] });
  const mk = (label, status, expiresAt) => prisma.seatLock.create({ data: { showtimeId: showtime.id, seatId: seatId(label), orderId: o.id, status, expiresAt } });
  await mk('A1', 'HELD', past()); // quá hạn: bị xóa
  await mk('A2', 'HELD', future()); // còn hạn: giữ
  await mk('A3', 'SOLD', past()); // SOLD: TUYỆT ĐỐI không xóa dù có hạn trong quá khứ
  await mk('A4', 'HELD', past()); // quá hạn nhưng KHÔNG nằm trong danh sách xin
  await lockDao.deleteExpiredHeldLocks({ showtimeId: showtime.id, seatIds: [seatId('A1'), seatId('A2'), seatId('A3')], now: new Date() });
  const left = (await prisma.seatLock.findMany({ where: { orderId: o.id } })).map((l) => l.seatId).sort();
  assert.deepEqual(left, [seatId('A2'), seatId('A3'), seatId('A4')].sort());
  await prisma.seatLock.deleteMany({ where: { orderId: o.id } });
});

test('findTakenLocks: SOLD và HELD còn hạn tính là bị chiếm (kèm hàng + số ghế); HELD quá hạn thì không; chỉ các ghế được hỏi', async () => {
  const o = await mkOrder(user, { labels: ['A1', 'A2', 'A3', 'A4'] });
  const mk = (label, status, expiresAt) => prisma.seatLock.create({ data: { showtimeId: showtime.id, seatId: seatId(label), orderId: o.id, status, expiresAt } });
  await mk('A1', 'SOLD', null); await mk('A2', 'HELD', future()); await mk('A3', 'HELD', past()); await mk('A4', 'SOLD', null);
  const taken = await lockDao.findTakenLocks({ showtimeId: showtime.id, seatIds: [seatId('A1'), seatId('A2'), seatId('A3')], now: new Date() });
  assert.deepEqual(taken.map((l) => `${l.seat.row}${l.seat.number}`).sort(), ['A1', 'A2']);
  await prisma.seatLock.deleteMany({ where: { orderId: o.id } });
});

test('deleteLocksOfOrder / deleteLocksOfOrders xóa MỌI khóa của đúng các đơn đó; deleteHeldLocksOfOrder chỉ xóa HELD (giữ ghế đã bán)', async () => {
  const a = await mkOrder(user, { labels: ['A1', 'A2'] });
  const b = await mkOrder(other, { labels: ['A3'] });
  const c = await mkOrder(other, { labels: ['A4'] });
  const lock = (o, label, status) => prisma.seatLock.create({ data: { showtimeId: showtime.id, seatId: seatId(label), orderId: o.id, status, expiresAt: status === 'HELD' ? future() : null } });
  await lock(a, 'A1', 'HELD'); await lock(a, 'A2', 'SOLD'); await lock(b, 'A3', 'HELD'); await lock(c, 'A4', 'HELD');

  await lockDao.deleteHeldLocksOfOrder(a.id);
  assert.deepEqual((await prisma.seatLock.findMany({ where: { orderId: a.id } })).map((l) => l.status), ['SOLD']); // SOLD còn nguyên
  await lockDao.deleteLocksOfOrder(a.id);
  assert.equal(await prisma.seatLock.count({ where: { orderId: a.id } }), 0);
  assert.equal(await prisma.seatLock.count({ where: { orderId: { in: [b.id, c.id] } } }), 2); // đơn khác nguyên vẹn
  await lockDao.deleteLocksOfOrders([b.id, c.id]);
  assert.equal(await prisma.seatLock.count({ where: { showtimeId: showtime.id } }), 0);
});

test('findActivePendingOrderIds: chỉ đơn PENDING CÒN HẠN của ĐÚNG user (không lấy đơn hết hạn, đã trả, đã hủy, của người khác); markOrdersCancelled chỉ đổi các đơn đã cho', async () => {
  const live = await mkOrder(user);
  await mkOrder(user, { expiresAt: past() });
  await mkOrder(user, { status: 'PAID' });
  await mkOrder(user, { status: 'CANCELLED' });
  const theirs = await mkOrder(other);
  const ids = await orderDao.findActivePendingOrderIds({ userId: user.id, now: new Date() });
  assert.ok(ids.includes(live.id));
  assert.ok(!ids.includes(theirs.id));
  const rows = await prisma.order.findMany({ where: { id: { in: ids } } });
  assert.ok(rows.every((o) => o.userId === user.id && o.status === 'PENDING' && o.expiresAt > new Date())); // đơn hết hạn / đã trả / đã hủy KHÔNG lọt vào

  await orderDao.markOrdersCancelled([live.id]);
  assert.equal((await orderDao.getOrderStatus(live.id)).status, 'CANCELLED');
  assert.equal((await orderDao.getOrderStatus(theirs.id)).status, 'PENDING');
});

test('⭐ cancelPendingOrderIfNotExpired: trả count — chỉ PENDING còn hạn; đơn đã PAID / hết hạn / đã hủy -> 0 và KHÔNG đổi; 10 lần song song chỉ 1 lần thắng', async () => {
  const pending = await mkOrder(user);
  const paid = await mkOrder(user, { status: 'PAID' });
  const expired = await mkOrder(user, { expiresAt: past() });
  const now = new Date();
  assert.equal(await orderDao.cancelPendingOrderIfNotExpired({ orderId: paid.id, now }), 0);
  assert.equal(await orderDao.cancelPendingOrderIfNotExpired({ orderId: expired.id, now }), 0);
  assert.equal((await orderDao.getOrderStatus(paid.id)).status, 'PAID');
  assert.equal((await orderDao.getOrderStatus(expired.id)).status, 'PENDING'); // việc chuyển EXPIRED là của tác vụ dọn dẹp

  const counts = await Promise.all(Array.from({ length: 10 }, () => orderDao.cancelPendingOrderIfNotExpired({ orderId: pending.id, now })));
  assert.equal(counts.filter((c) => c === 1).length, 1);
  assert.equal((await orderDao.getOrderStatus(pending.id)).status, 'CANCELLED');
});

test('⭐ listStalePendingOrderIds / markOrderExpiredIfStale: chỉ đơn PENDING QUÁ HẠN; đơn đã PAID (dù quá hạn) hay còn hạn KHÔNG bị đụng; chỉ một lần chuyển EXPIRED thành công', async () => {
  const stale = await mkOrder(user, { expiresAt: past() });
  const paidLate = await mkOrder(user, { expiresAt: past(), status: 'PAID' });
  const fresh = await mkOrder(user);
  const now = new Date();
  const ids = await orderDao.listStalePendingOrderIds({ now });
  assert.ok(ids.includes(stale.id));
  assert.ok(!ids.includes(paidLate.id) && !ids.includes(fresh.id));

  assert.equal(await orderDao.markOrderExpiredIfStale({ orderId: paidLate.id, now }), 0); // IPN vừa xác nhận: không ghi đè
  assert.equal((await orderDao.getOrderStatus(paidLate.id)).status, 'PAID');
  assert.equal(await orderDao.markOrderExpiredIfStale({ orderId: fresh.id, now }), 0);
  const counts = await Promise.all(Array.from({ length: 5 }, () => orderDao.markOrderExpiredIfStale({ orderId: stale.id, now })));
  assert.equal(counts.filter((c) => c === 1).length, 1);
  assert.equal((await orderDao.getOrderStatus(stale.id)).status, 'EXPIRED');
});

test('touchPendingOrder: chỉ chiếm được đơn PENDING còn hạn (trả 1); đơn hết hạn / đã trả -> 0', async () => {
  const live = await mkOrder(user);
  const expired = await mkOrder(user, { expiresAt: past() });
  const paid = await mkOrder(user, { status: 'PAID' });
  const now = new Date();
  assert.equal(await orderDao.touchPendingOrder({ orderId: live.id, now }), 1);
  assert.equal(await orderDao.touchPendingOrder({ orderId: expired.id, now }), 0);
  assert.equal(await orderDao.touchPendingOrder({ orderId: paid.id, now }), 0);
});

test('"vé của tôi": countOrdersOfUser + findOrdersOfUser lọc đúng user và trạng thái, mới nhất trước, phân trang, kèm ghế và suất', async () => {
  await prisma.order.deleteMany({ where: { userId: { in: [user.id, other.id] } } });
  const p1 = await mkOrder(user, { status: 'PAID' });
  await new Promise((r) => setTimeout(r, 15));
  const p2 = await mkOrder(user, { status: 'PAID', labels: ['A1', 'A2'] });
  await mkOrder(user, { status: 'CANCELLED' });
  await mkOrder(other, { status: 'PAID' });
  const filter = { userId: user.id, status: 'PAID' };
  assert.equal(await orderDao.countOrdersOfUser(filter), 2);
  const rows = await orderDao.findOrdersOfUser(filter, { skip: 0, take: 10 });
  assert.deepEqual(rows.map((r) => r.id), [p2.id, p1.id]); // mới nhất trước
  assert.deepEqual(rows[0].tickets.map((s) => s.seatLabel), ['A1', 'A2']);
  assert.ok(rows[0].showtime.movie.title && rows[0].showtime.room.cinema.name);
  assert.deepEqual((await orderDao.findOrdersOfUser(filter, { skip: 1, take: 1 })).map((r) => r.id), [p1.id]);
  assert.equal(await orderDao.countOrdersOfUser({ userId: user.id, status: 'REFUNDED' }), 0);
});

test('tính lại tiền: getOrderForRecalc / getOrderLines đọc đủ dòng; updateOrderTotals ghi đúng; setOrderPromotion gắn và gỡ mã', async () => {
  const o = await mkOrder(user, { labels: ['A1', 'A2'] });
  const full = await orderDao.getOrderForRecalc(o.id);
  assert.equal(full.tickets.length, 2);
  assert.ok(Array.isArray(full.combos) && full.promotion === null);
  assert.equal((await orderDao.getOrderLines(o.id)).tickets.length, 2);

  await orderDao.updateOrderTotals(o.id, { seatTotal: 100_000, comboTotal: 70_000, discount: 17_000, promotionId: null, total: 153_000 });
  const after = await orderDao.getOrderStatus(o.id);
  assert.equal(after.status, 'PENDING');
  const row = await prisma.order.findUnique({ where: { id: o.id } });
  assert.deepEqual([row.comboTotal, row.discount, row.total], [70_000, 17_000, 153_000]);

  const promo = await prisma.promotion.findFirst();
  await orderDao.setOrderPromotion(o.id, promo.id);
  assert.equal((await orderDao.getOrderForRecalc(o.id)).promotion.code, promo.code);
  await orderDao.setOrderPromotion(o.id, null);
  assert.equal((await orderDao.getOrderForRecalc(o.id)).promotion, null);
});

test('combo DAO: findActiveCombosByIds bỏ combo ngừng bán / không tồn tại; deleteCombosOfOrder chỉ xóa của MỘT đơn; insertOrderCombos ghi giá đã chốt', async () => {
  const mkCombo = (tag, isActive) => prisma.combo.create({ data: { name: `TestCombo-${RUN}-${tag}`, price: 50_000, isActive } });
  const on = await mkCombo('on', true);
  const off = await mkCombo('off', false);
  const found = await comboDao.findActiveCombosByIds([on.id, off.id, '00000000-0000-4000-8000-000000000000']);
  assert.deepEqual(found.map((c) => c.id), [on.id]);

  const a = await mkOrder(user); const b = await mkOrder(other);
  await orderComboDao.insertOrderCombos({ orderId: a.id, items: [{ comboId: on.id, quantity: 2, unitPrice: 45_000 }] });
  await orderComboDao.insertOrderCombos({ orderId: b.id, items: [{ comboId: on.id, quantity: 1, unitPrice: 50_000 }] });
  const lineA = await prisma.orderCombo.findFirst({ where: { orderId: a.id } });
  assert.deepEqual([lineA.quantity, lineA.unitPrice], [2, 45_000]); // giá CHỐT, không phải giá hiện tại của combo
  await orderComboDao.deleteCombosOfOrder(a.id);
  assert.equal(await prisma.orderCombo.count({ where: { orderId: a.id } }), 0);
  assert.equal(await prisma.orderCombo.count({ where: { orderId: b.id } }), 1); // đơn khác nguyên vẹn
});

test('seat DAO: findSeatsInRoom chỉ trả ghế thuộc ĐÚNG phòng; showtime DAO: getShowtimeById trả suất thô hoặc null', async () => {
  const foreign = await prisma.seat.findFirst({ where: { roomId: { not: room.id } } });
  const found = await seatDao.findSeatsInRoom({ roomId: room.id, seatIds: [seatId('A1'), seatId('A2'), foreign.id] });
  assert.deepEqual(found.map((s) => `${s.row}${s.number}`).sort(), ['A1', 'A2']);
  assert.equal((await showtimeDao.getShowtimeById(showtime.id)).roomId, room.id);
  assert.equal(await showtimeDao.getShowtimeById('00000000-0000-4000-8000-000000000000'), null);
});
