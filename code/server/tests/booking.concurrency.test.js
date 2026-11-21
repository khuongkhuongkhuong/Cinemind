// ⭐ Test quan trọng nhất của đề tài: chống trùng ghế khi nhiều người đặt cùng lúc.
// Cần dữ liệu mẫu: chạy `npm run db:seed` trước.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { prisma } = await import('../src/config/prisma.js');
const { holdSeats, getOrder } = await import('../src/services/order.service.js');
const { default: app } = await import('../src/app.js');
const { signAccessToken } = await import('../src/lib/jwt.js');

const minute = 60_000;
const RUN = Date.now();
let showtime;
let seats; // ghế của phòng, theo nhãn: seat('A1')
let users = [];
let tempShowtimeIds = [];

const seat = (label) => seats.find((s) => `${s.row}${s.number}` === label);
const ids = (...labels) => labels.map((l) => seat(l).id);
const hold = (user, ...labels) => holdSeats({ userId: user.id, showtimeId: showtime.id, seatIds: ids(...labels) });
const failCode = (promise) => promise.then(() => null, (e) => e.code);
// Vé ĐANG CHIẾM ghế (HELD/SOLD): occupiedSeatId khác NULL. Vé đã nhả (RELEASED) vẫn còn làm lịch sử nhưng không chiếm ghế.
const locksOf = (...labels) => prisma.ticket.findMany({ where: { showtimeId: showtime.id, seatId: { in: ids(...labels) }, occupiedSeatId: { not: null } } });

async function newUsers(n) {
  const created = [];
  for (let i = 0; i < n; i++) {
    created.push(await prisma.user.create({
      data: { email: `test-book-${RUN}-${users.length + i}@example.com`, passwordHash: 'x', fullName: `Test ${i}` },
    }));
  }
  users.push(...created);
  return created;
}

before(async () => {
  // Dùng suất chiếu XA nhất để không đụng các test khác chạy song song.
  showtime = await prisma.showtime.findFirst({ where: { status: 'OPEN', startTime: { lt: new Date(Date.now() + 30 * 86_400_000) }, room: { name: { startsWith: 'Phòng ' }, seats: { some: {} } } }, orderBy: { startTime: 'desc' } });
  seats = await prisma.seat.findMany({ where: { roomId: showtime.roomId } });
});

after(async () => {
  const userIds = users.map((u) => u.id);
  await prisma.order.deleteMany({ where: { userId: { in: userIds } } }); // Ticket xóa theo (cascade)
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.showtime.deleteMany({ where: { id: { in: tempShowtimeIds } } });
  await prisma.$disconnect();
});

test('⭐ 50 người cùng giành A1+A2 một lúc: ĐÚNG 1 người thắng, 49 người nhận SEAT_UNAVAILABLE', async () => {
  const racers = await newUsers(50);
  const results = await Promise.all(racers.map((u) => hold(u, 'A1', 'A2').then((o) => ({ ok: o }), (e) => ({ err: e }))));

  const winners = results.filter((r) => r.ok);
  const losers = results.filter((r) => r.err);
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 49);
  assert.ok(losers.every((r) => r.err.code === 'SEAT_UNAVAILABLE'), 'mọi người thua đều phải nhận SEAT_UNAVAILABLE');
  assert.deepEqual(losers[0].err.details.seatLabels.sort(), ['A1', 'A2']);

  // DB: đúng 2 vé chiếm ghế (occupiedSeatId khác NULL) cho A1, A2 — đều thuộc đơn của người thắng — và đúng 1 đơn:
  // người thua rollback sạch, không để lại đơn rác, không để lại vé nào.
  const locks = await locksOf('A1', 'A2');
  assert.equal(locks.length, 2);
  assert.deepEqual(locks.map((l) => l.occupiedSeatId).sort(), ids('A1', 'A2').sort());
  assert.ok(locks.every((l) => l.orderId === winners[0].ok.id && l.status === 'HELD'));
  const orders = await prisma.order.count({ where: { userId: { in: racers.map((u) => u.id) } } });
  assert.equal(orders, 1);
});

test('⭐ tất cả hoặc không: Y xin B1+B2+B3 khi B3 đã bị giữ -> thất bại, B1 và B2 KHÔNG bị giữ', async () => {
  const [x, y] = await newUsers(2);
  await hold(x, 'B3');
  assert.equal(await failCode(hold(y, 'B1', 'B2', 'B3')), 'SEAT_UNAVAILABLE');
  assert.equal((await locksOf('B1', 'B2')).length, 0);
  assert.equal(await prisma.order.count({ where: { userId: y.id } }), 0);
});

test('lượt giữ quá hạn coi như trống: người khác giữ được ngay, không cần chờ cron', async () => {
  const [old, fresh] = await newUsers(2);
  // Hạn giữ ghế nằm ở ĐƠN (docs/03 v1.3): đơn quá hạn + vé HELD của nó = ghế trống.
  const stale = await prisma.order.create({
    data: {
      code: `EXP${RUN}`.slice(0, 12), userId: old.id, expiresAt: new Date(Date.now() - minute), seatTotal: 0, total: 0,
      tickets: { create: [{ showtimeId: showtime.id, seatId: seat('C1').id, seatLabel: 'C1', seatType: seat('C1').type, price: 0, status: 'HELD', occupiedSeatId: seat('C1').id }] },
    },
  });
  const order = await hold(fresh, 'C1');
  assert.equal(order.status, 'PENDING');
  const [lock] = await locksOf('C1');
  assert.equal(lock.orderId, order.id);
  // dọn lười: vé quá hạn được nhả NGAY trong transaction giữ ghế (không chờ cron) và vẫn còn làm lịch sử
  const [old1] = await prisma.ticket.findMany({ where: { orderId: stale.id } });
  assert.deepEqual([old1.status, old1.occupiedSeatId], ['RELEASED', null]);
});

test('ghế đã SOLD thì không giữ được', async () => {
  const [buyer, other] = await newUsers(2);
  const paid = await hold(buyer, 'C5');
  await prisma.ticket.updateMany({ where: { orderId: paid.id }, data: { status: 'SOLD' } }); // occupiedSeatId vẫn = seatId
  assert.equal(await failCode(hold(other, 'C5')), 'SEAT_UNAVAILABLE');
});

test('BR-03: tạo đơn mới thì đơn PENDING cũ bị hủy và ghế được nhả', async () => {
  const [u] = await newUsers(1);
  const first = await hold(u, 'D1');
  const second = await hold(u, 'D2');
  assert.equal((await prisma.order.findUnique({ where: { id: first.id } })).status, 'CANCELLED');
  assert.equal((await locksOf('D1')).length, 0);
  assert.equal((await locksOf('D2')).length, 1);
  // vé của đơn cũ KHÔNG bị xóa: chuyển RELEASED, còn làm lịch sử
  assert.deepEqual((await prisma.ticket.findMany({ where: { orderId: first.id } })).map((t) => [t.status, t.occupiedSeatId]), [['RELEASED', null]]);
  assert.equal(second.status, 'PENDING');
});

test('lần giữ mới THẤT BẠI thì đơn cũ vẫn còn nguyên (rollback cả bước hủy đơn cũ)', async () => {
  const [u, rival] = await newUsers(2);
  const mine = await hold(u, 'D5');
  await hold(rival, 'D6');
  assert.equal(await failCode(hold(u, 'D6')), 'SEAT_UNAVAILABLE');
  assert.equal((await prisma.order.findUnique({ where: { id: mine.id } })).status, 'PENDING');
  assert.equal((await locksOf('D5')).length, 1);
});

test('giá được chốt vào đơn và server tự tính (BR-11, BR-13, BR-14, BR-15)', async () => {
  const [u] = await newUsers(1);
  const order = await hold(u, 'A5', 'E1', 'H1', 'H2'); // thường, VIP, cặp đôi
  const price = (label) => order.seats.find((s) => s.label === label).price;
  const base = showtime.basePrice;
  assert.equal(price('A5'), base);
  assert.equal(price('E1'), base + 15000);
  assert.equal(price('H1') + price('H2'), base * 2 + 20000); // mỗi ghế đôi lưu một nửa giá cặp
  assert.equal(order.total, order.seats.reduce((sum, s) => sum + s.price, 0));
  assert.equal(order.seatTotal, order.total);
  assert.ok(Math.abs(new Date(order.expiresAt) - Date.now() - 10 * minute) < 5000, 'hạn giữ 10 phút (BR-01)');
});

test('các luật kiểm tra trước: > 8 ghế, ghế đôi lẻ, suất sắp chiếu, ghế sai phòng', async () => {
  const [u] = await newUsers(1);
  const nine = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9'];
  assert.equal(await failCode(hold(u)), 'VALIDATION_ERROR'); // không có ghế nào: không tạo đơn rỗng
  assert.equal(await prisma.order.count({ where: { userId: u.id } }), 0);
  assert.equal(await failCode(hold(u, ...nine)), 'SEAT_LIMIT_EXCEEDED');
  assert.equal(await failCode(hold(u, 'H3')), 'COUPLE_SEAT_INCOMPLETE'); // chỉ 1 ghế của cặp H3-4
  assert.equal(await failCode(hold(u, 'H3', 'H5')), 'COUPLE_SEAT_INCOMPLETE'); // hai ghế khác cặp

  const soon = await prisma.showtime.create({
    data: { ...Object.fromEntries(['movieId', 'roomId', 'format', 'audio', 'basePrice'].map((k) => [k, showtime[k]])),
      startTime: new Date(Date.now() + 5 * minute), endTime: new Date(Date.now() + 100 * minute) },
  });
  tempShowtimeIds.push(soon.id);
  const closed = holdSeats({ userId: u.id, showtimeId: soon.id, seatIds: ids('G1') });
  assert.equal(await failCode(closed), 'SHOWTIME_CLOSED'); // BR-04: còn < 15 phút

  const otherRoomSeat = await prisma.seat.findFirst({ where: { roomId: { not: showtime.roomId } } });
  const wrong = holdSeats({ userId: u.id, showtimeId: showtime.id, seatIds: [otherRoomSeat.id] });
  assert.equal(await failCode(wrong), 'NOT_FOUND');
});

test('getOrder: chủ đơn xem được; người khác -> FORBIDDEN', async () => {
  const [owner, stranger] = await newUsers(2);
  const order = await hold(owner, 'G3');
  assert.equal((await getOrder({ userId: owner.id, orderId: order.id })).code, order.code);
  assert.equal(await failCode(getOrder({ userId: stranger.id, orderId: order.id })), 'FORBIDDEN');
});

test('POST /orders qua HTTP: không token -> 401; có token -> 201; thiếu seatIds -> 400', async () => {
  const [u] = await newUsers(1);
  const server = app.listen(0);
  const url = `http://localhost:${server.address().port}/api/v1/orders`;
  const post = (body, token) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  });
  try {
    const token = signAccessToken({ id: u.id, role: 'USER' });
    assert.equal((await post({ showtimeId: showtime.id, seatIds: ids('G7') })).status, 401);
    assert.equal((await post({ showtimeId: showtime.id }, token)).status, 400);
    const res = await post({ showtimeId: showtime.id, seatIds: ids('G7') }, token);
    assert.equal(res.status, 201);
    const json = await res.json();
    assert.equal(json.data.status, 'PENDING');
    assert.equal(json.data.seats[0].label, 'G7');
  } finally {
    server.close();
  }
});

test('hủy đơn: vé -> RELEASED + occupiedSeatId NULL (vé cũ vẫn còn làm lịch sử); người khác giữ được chính ghế đó', async () => {
  const { cancelOrder } = await import('../src/services/order.service.js');
  const [a, b] = await newUsers(2);
  const order = await hold(a, 'E5');
  await cancelOrder({ userId: a.id, orderId: order.id });
  assert.deepEqual((await prisma.ticket.findMany({ where: { orderId: order.id } })).map((t) => [t.status, t.occupiedSeatId]), [['RELEASED', null]]);
  assert.equal((await locksOf('E5')).length, 0);
  const next = await hold(b, 'E5');
  assert.equal((await locksOf('E5'))[0].orderId, next.id);
  assert.equal(await prisma.ticket.count({ where: { orderId: order.id } }), 1); // vé cũ vẫn còn
});

test('⭐ bất biến occupiedSeatId (docs/03 mục 1.2): với MỌI vé của các user test, (HELD hoặc SOLD) <=> occupiedSeatId có giá trị và = seatId; RELEASED <=> NULL', async () => {
  const tickets = await prisma.ticket.findMany({ where: { order: { userId: { in: users.map((u) => u.id) } } } });
  assert.ok(tickets.length > 10, 'cần có dữ liệu từ các test trước để bất biến có ý nghĩa');
  const bad = tickets.filter((t) => (t.status !== 'RELEASED') !== (t.occupiedSeatId !== null) || (t.occupiedSeatId !== null && t.occupiedSeatId !== t.seatId));
  assert.deepEqual(bad.map((t) => [t.seatLabel, t.status, t.occupiedSeatId]), []);
});
