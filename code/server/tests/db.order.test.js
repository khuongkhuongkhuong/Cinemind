// Truy vấn nội bộ của đơn hàng (order / orderCombo / combo / seat). Vé và trọng tài chống trùng ghế: xem dao.ticket.test.js. Mỗi hàm là MỘT thao tác truy vấn: test kiểm ĐÚNG điều kiện của câu lệnh,
// đặc biệt các câu ⭐ (chèn khóa ghế, cập nhật có điều kiện). Cần dữ liệu mẫu: chạy `npm run db:seed` trước.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { prisma } = await import('../src/config/prisma.js');
const { runInTransaction } = await import('../src/config/prisma.js');
const orderSvc = await import('../src/services/order.service.js');
const seatSvc = await import('../src/services/seat.service.js');
const showtimeSvc = await import('../src/services/showtime.service.js');
const comboSvc = await import('../src/services/combo.service.js');

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
  showtime = await showtimeSvc.insertShowtime({ movieId: movie.id, roomId: room.id, startTime: start, endTime: new Date(start.getTime() + 2 * 60 * minute), format: 'F2D', audio: 'SUBTITLE', basePrice: 80_000 });
  user = await prisma.user.create({ data: { email: `test-daobk-${RUN}-a@example.com`, passwordHash: 'x', fullName: 'Test A' } });
  other = await prisma.user.create({ data: { email: `test-daobk-${RUN}-b@example.com`, passwordHash: 'x', fullName: 'Test B' } });
});
after(async () => {
  await prisma.order.deleteMany({ where: { userId: { in: [user.id, other.id] } } }); // Ticket + OrderCombo xóa theo (cascade)
  await prisma.combo.deleteMany({ where: { name: { startsWith: `TestCombo-${RUN}` } } });
  await prisma.showtime.deleteMany({ where: { roomId: room.id } });
  await prisma.seat.deleteMany({ where: { roomId: room.id } });
  await prisma.room.delete({ where: { id: room.id } });
  await prisma.user.deleteMany({ where: { id: { in: [user.id, other.id] } } });
  await prisma.$disconnect();
});

const future = () => new Date(Date.now() + 10 * minute);
const past = () => new Date(Date.now() - minute);
/**
 * Tạo đơn qua chính (truy vấn nội bộ) (`insertOrder`) rồi gắn vé. Vé ở trạng thái RELEASED (không chiếm ghế) để nhiều đơn của test này dùng chung nhãn A1.. mà không
 * vướng UNIQUE; việc chiếm ghế được kiểm riêng trong dao.ticket.test.js.
 */
const mkOrder = async (who, { status, expiresAt = future(), labels = ['A1'] } = {}) => {
  const o = await orderSvc.insertOrder({
    code: `DB${RUN}${process.pid}${n++}`.slice(-10), userId: who.id, source: 'WEB', expiresAt, seatTotal: 100_000, total: 100_000,
  });
  await prisma.ticket.createMany({
    data: labels.map((l) => ({ orderId: o.id, showtimeId: showtime.id, seatId: seatId(l), seatLabel: l, seatType: 'STANDARD', price: 50_000, status: 'RELEASED' })),
  });
  return status ? prisma.order.update({ where: { id: o.id }, data: { status, paidAt: status === 'PAID' ? new Date() : null } }) : o;
};

test('insertOrder: tạo đơn (mặc định PENDING, chưa có suất — suất nằm ở vé); getOrderDetail đọc kèm vé có GIÁ ĐÃ CHỐT; getOrderDetail / getOrderOwner / findOrderStatus / getOrderDetailByCode đọc lại', async () => {
  const o = await mkOrder(user, { labels: ['A1', 'A2'] });
  assert.equal(o.status, 'PENDING');
  assert.equal(o.source, 'WEB');
  const detail = await orderSvc.getOrderDetail(o.id);
  assert.deepEqual(detail.tickets.map((s) => [s.seatLabel, s.price]), [['A1', 50_000], ['A2', 50_000]]);
  assert.equal(detail.showtime, undefined); // Order không còn showtime
  assert.equal(detail.tickets[0].showtime.id, showtime.id); // suất lấy qua vé
  assert.deepEqual(await orderSvc.getOrderOwner(o.id), { userId: user.id });
  assert.deepEqual(await orderSvc.findOrderStatus(o.id), { status: 'PENDING' });
  assert.equal((await orderSvc.getOrderDetailByCode(o.code)).id, o.id);
  for (const fn of ['getOrderDetail', 'getOrderOwner', 'findOrderStatus', 'getOrderDetailByCode']) {
    assert.equal(await orderSvc[fn]('00000000-0000-4000-8000-000000000000'), null, fn);
  }
  assert.equal(await orderSvc.getOrderDetailByCode('KHONGCOMA'), null);
});

test('findActivePendingOrderIds: chỉ đơn PENDING CÒN HẠN của ĐÚNG user (không lấy đơn hết hạn, đã trả, đã hủy, của người khác); markOrdersCancelled chỉ đổi các đơn đã cho', async () => {
  const live = await mkOrder(user);
  await mkOrder(user, { expiresAt: past() });
  await mkOrder(user, { status: 'PAID' });
  await mkOrder(user, { status: 'CANCELLED' });
  const theirs = await mkOrder(other);
  const ids = await orderSvc.findActivePendingOrderIds({ userId: user.id, now: new Date() });
  assert.ok(ids.includes(live.id));
  assert.ok(!ids.includes(theirs.id));
  const rows = await prisma.order.findMany({ where: { id: { in: ids } } });
  assert.ok(rows.every((o) => o.userId === user.id && o.status === 'PENDING' && o.expiresAt > new Date())); // đơn hết hạn / đã trả / đã hủy KHÔNG lọt vào

  await orderSvc.markOrdersCancelled([live.id]);
  assert.equal((await orderSvc.findOrderStatus(live.id)).status, 'CANCELLED');
  assert.equal((await orderSvc.findOrderStatus(theirs.id)).status, 'PENDING');
});

test('⭐ cancelPendingOrderIfNotExpired: trả count — chỉ PENDING còn hạn; đơn đã PAID / hết hạn / đã hủy -> 0 và KHÔNG đổi; 10 lần song song chỉ 1 lần thắng', async () => {
  const pending = await mkOrder(user);
  const paid = await mkOrder(user, { status: 'PAID' });
  const expired = await mkOrder(user, { expiresAt: past() });
  const now = new Date();
  assert.equal(await orderSvc.cancelPendingOrderIfNotExpired({ orderId: paid.id, now }), 0);
  assert.equal(await orderSvc.cancelPendingOrderIfNotExpired({ orderId: expired.id, now }), 0);
  assert.equal((await orderSvc.findOrderStatus(paid.id)).status, 'PAID');
  assert.equal((await orderSvc.findOrderStatus(expired.id)).status, 'PENDING'); // việc chuyển EXPIRED là của tác vụ dọn dẹp

  const counts = await Promise.all(Array.from({ length: 10 }, () => orderSvc.cancelPendingOrderIfNotExpired({ orderId: pending.id, now })));
  assert.equal(counts.filter((c) => c === 1).length, 1);
  assert.equal((await orderSvc.findOrderStatus(pending.id)).status, 'CANCELLED');
});

test('⭐ listStalePendingOrderIds / markOrderExpiredIfStale: chỉ đơn PENDING QUÁ HẠN; đơn đã PAID (dù quá hạn) hay còn hạn KHÔNG bị đụng; chỉ một lần chuyển EXPIRED thành công', async () => {
  const stale = await mkOrder(user, { expiresAt: past() });
  const paidLate = await mkOrder(user, { expiresAt: past(), status: 'PAID' });
  const fresh = await mkOrder(user);
  const now = new Date();
  const ids = await orderSvc.listStalePendingOrderIds({ now });
  assert.ok(ids.includes(stale.id));
  assert.ok(!ids.includes(paidLate.id) && !ids.includes(fresh.id));

  assert.equal(await orderSvc.markOrderExpiredIfStale({ orderId: paidLate.id, now }), 0); // IPN vừa xác nhận: không ghi đè
  assert.equal((await orderSvc.findOrderStatus(paidLate.id)).status, 'PAID');
  assert.equal(await orderSvc.markOrderExpiredIfStale({ orderId: fresh.id, now }), 0);
  const counts = await Promise.all(Array.from({ length: 5 }, () => orderSvc.markOrderExpiredIfStale({ orderId: stale.id, now })));
  assert.equal(counts.filter((c) => c === 1).length, 1);
  assert.equal((await orderSvc.findOrderStatus(stale.id)).status, 'EXPIRED');
});

test('touchPendingOrder: chỉ chiếm được đơn PENDING còn hạn (trả 1); đơn hết hạn / đã trả -> 0', async () => {
  const live = await mkOrder(user);
  const expired = await mkOrder(user, { expiresAt: past() });
  const paid = await mkOrder(user, { status: 'PAID' });
  const now = new Date();
  assert.equal(await orderSvc.touchPendingOrder({ orderId: live.id, now }), 1);
  assert.equal(await orderSvc.touchPendingOrder({ orderId: expired.id, now }), 0);
  assert.equal(await orderSvc.touchPendingOrder({ orderId: paid.id, now }), 0);
});

test('"vé của tôi": countOrdersOfUser + findOrdersOfUser lọc đúng user và trạng thái, mới nhất trước, phân trang, kèm ghế và suất', async () => {
  await prisma.order.deleteMany({ where: { userId: { in: [user.id, other.id] } } });
  const p1 = await mkOrder(user, { status: 'PAID' });
  await new Promise((r) => setTimeout(r, 15));
  const p2 = await mkOrder(user, { status: 'PAID', labels: ['A1', 'A2'] });
  await mkOrder(user, { status: 'CANCELLED' });
  await mkOrder(other, { status: 'PAID' });
  const filter = { userId: user.id, status: 'PAID' };
  assert.equal(await orderSvc.countOrdersOfUser(filter), 2);
  const rows = await orderSvc.findOrdersOfUser(filter, { skip: 0, take: 10 });
  assert.deepEqual(rows.map((r) => r.id), [p2.id, p1.id]); // mới nhất trước
  assert.deepEqual(rows[0].tickets.map((s) => s.seatLabel), ['A1', 'A2']);
  assert.ok(rows[0].tickets[0].showtime.movie.title && rows[0].tickets[0].showtime.room.cinema.name);
  assert.deepEqual((await orderSvc.findOrdersOfUser(filter, { skip: 1, take: 1 })).map((r) => r.id), [p1.id]);
  assert.equal(await orderSvc.countOrdersOfUser({ userId: user.id, status: 'REFUNDED' }), 0);
});

test('tính lại tiền: getOrderForRecalc / getOrderLines đọc đủ dòng; updateOrderTotals ghi đúng; setOrderPromotion gắn và gỡ mã', async () => {
  const o = await mkOrder(user, { labels: ['A1', 'A2'] });
  const full = await orderSvc.getOrderForRecalc(o.id);
  assert.equal(full.tickets.length, 2);
  assert.ok(Array.isArray(full.combos) && full.promotion === null);
  assert.equal((await orderSvc.getOrderLines(o.id)).tickets.length, 2);

  await orderSvc.updateOrderTotals(o.id, { seatTotal: 100_000, comboTotal: 70_000, discount: 17_000, promotionId: null, total: 153_000 });
  const after = await orderSvc.findOrderStatus(o.id);
  assert.equal(after.status, 'PENDING');
  const row = await prisma.order.findUnique({ where: { id: o.id } });
  assert.deepEqual([row.comboTotal, row.discount, row.total], [70_000, 17_000, 153_000]);

  const promo = await prisma.promotion.findFirst();
  await orderSvc.setOrderPromotion(o.id, promo.id);
  assert.equal((await orderSvc.getOrderForRecalc(o.id)).promotion.code, promo.code);
  await orderSvc.setOrderPromotion(o.id, null);
  assert.equal((await orderSvc.getOrderForRecalc(o.id)).promotion, null);
});

test('combo (truy vấn nội bộ): findActiveCombosByIds bỏ combo ngừng bán / không tồn tại; deleteCombosOfOrder chỉ xóa của MỘT đơn; insertOrderCombos ghi giá đã chốt', async () => {
  const mkCombo = (tag, isActive) => prisma.combo.create({ data: { name: `TestCombo-${RUN}-${tag}`, price: 50_000, isActive } });
  const on = await mkCombo('on', true);
  const off = await mkCombo('off', false);
  const found = await comboSvc.getActiveCombos([on.id, off.id, '00000000-0000-4000-8000-000000000000']);
  assert.deepEqual(found.map((c) => c.id), [on.id]);

  const a = await mkOrder(user); const b = await mkOrder(other);
  await orderSvc.insertOrderCombos({ orderId: a.id, items: [{ comboId: on.id, quantity: 2, unitPrice: 45_000 }] });
  await orderSvc.insertOrderCombos({ orderId: b.id, items: [{ comboId: on.id, quantity: 1, unitPrice: 50_000 }] });
  const lineA = await prisma.orderCombo.findFirst({ where: { orderId: a.id } });
  assert.deepEqual([lineA.quantity, lineA.unitPrice], [2, 45_000]); // giá CHỐT, không phải giá hiện tại của combo
  await orderSvc.deleteCombosOfOrder(a.id);
  assert.equal(await prisma.orderCombo.count({ where: { orderId: a.id } }), 0);
  assert.equal(await prisma.orderCombo.count({ where: { orderId: b.id } }), 1); // đơn khác nguyên vẹn
});

test('seat (truy vấn nội bộ): findSeatsInRoom chỉ trả ghế thuộc ĐÚNG phòng; showtime (truy vấn nội bộ): getShowtimeById trả suất thô hoặc null', async () => {
  const foreign = await prisma.seat.findFirst({ where: { roomId: { not: room.id } } });
  const found = await seatSvc.findSeatsInRoom({ roomId: room.id, seatIds: [seatId('A1'), seatId('A2'), foreign.id] });
  assert.deepEqual(found.map((s) => `${s.row}${s.number}`).sort(), ['A1', 'A2']);
  assert.equal((await showtimeSvc.getShowtimeById(showtime.id)).roomId, room.id);
  assert.equal(await showtimeSvc.getShowtimeById('00000000-0000-4000-8000-000000000000'), null);
});
