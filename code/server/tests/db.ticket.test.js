// Truy vấn nội bộ của vé (ticket.dao) — vé là lớp trung gian Suất chiếu – Ghế (docs/03 v1.3). Mỗi hàm là MỘT thao tác truy vấn: test kiểm ĐÚNG điều kiện của
// từng câu lệnh, nhất là ⭐ trọng tài chống trùng ghế UNIQUE (showtimeId, occupiedSeatId) và bất biến "occupiedSeatId chỉ có khi vé HELD/SOLD".
// Dùng phòng + suất riêng của test (TestRoom-...) nên không đụng dữ liệu mẫu và không tranh ghế với test khác.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { prisma } = await import('../src/config/prisma.js');
const { runInTransaction } = await import('../src/config/prisma.js');
const ticketSvc = await import('../src/services/ticket.service.js');
const orderSvc = await import('../src/services/order.service.js');
const showtimeSvc = await import('../src/services/showtime.service.js');

const minute = 60_000;
const DAY = 24 * 60 * minute;
const RUN = Date.now();
let room; let showtime; let showtime2; let user; let other; let seats; let n = 0;
const seatId = (label) => seats[label].id;

before(async () => {
  const cinema = await prisma.cinema.findFirst({ where: { name: { startsWith: 'Cinemind' }, isActive: true }, orderBy: { name: 'asc' } });
  const movie = await prisma.movie.findFirst({ where: { status: 'NOW_SHOWING', description: { not: 'Mô tả thử' } } });
  room = await prisma.room.create({ data: { cinemaId: cinema.id, name: `TestRoom-${RUN}-daotk` } });
  await prisma.seat.createMany({ data: ['A1', 'A2', 'A3', 'A4', 'A5'].map((l) => ({ roomId: room.id, row: l[0], number: Number(l[1]), type: 'STANDARD' })) });
  seats = Object.fromEntries((await prisma.seat.findMany({ where: { roomId: room.id } })).map((s) => [`${s.row}${s.number}`, s]));
  const mkShowtime = (daysAhead) => {
    const start = new Date(Math.ceil((Date.now() + daysAhead * DAY) / (60 * minute)) * 60 * minute);
    return showtimeSvc.insertShowtime({ movieId: movie.id, roomId: room.id, startTime: start, endTime: new Date(start.getTime() + 2 * 60 * minute), format: 'F2D', audio: 'SUBTITLE', basePrice: 80_000 });
  };
  showtime = await mkShowtime(110);
  showtime2 = await mkShowtime(112);
  user = await prisma.user.create({ data: { email: `test-daotk-${RUN}-a@example.com`, passwordHash: 'x', fullName: 'Test A' } });
  other = await prisma.user.create({ data: { email: `test-daotk-${RUN}-b@example.com`, passwordHash: 'x', fullName: 'Test B' } });
});
after(async () => {
  await prisma.order.deleteMany({ where: { userId: { in: [user.id, other.id] } } }); // Ticket xóa theo (cascade)
  await prisma.showtime.deleteMany({ where: { roomId: room.id } });
  await prisma.seat.deleteMany({ where: { roomId: room.id } });
  await prisma.room.delete({ where: { id: room.id } });
  await prisma.user.deleteMany({ where: { id: { in: [user.id, other.id] } } });
  await prisma.$disconnect();
});

const future = () => new Date(Date.now() + 10 * minute);
const past = () => new Date(Date.now() - minute);
const mkOrder = (who, { expiresAt = future(), status } = {}, db) => orderSvc.insertOrder({
  code: `DT${RUN}${process.pid}${n++}`.slice(-10), userId: who.id, source: 'WEB', expiresAt, seatTotal: 1, total: 1, ...(status && { status }),
}, db);
const row = (orderId, st, label, extra = {}) => ({ orderId, showtimeId: st.id, seatId: seatId(label), seatLabel: label, seatType: 'STANDARD', price: 50_000, ...extra });
const ticketsOf = (orderId) => prisma.ticket.findMany({ where: { orderId }, orderBy: { seatLabel: 'asc' } });
const reset = () => prisma.order.deleteMany({ where: { userId: { in: [user.id, other.id] } } });

/** ⭐ Bất biến R5: vé HELD/SOLD <=> occupiedSeatId = seatId; vé RELEASED <=> occupiedSeatId NULL. */
async function assertInvariant() {
  const bad = await prisma.$queryRaw`
    SELECT count(*)::int AS n FROM "Ticket" t JOIN "Order" o ON o."id" = t."orderId"
    WHERE o."userId" IN (${user.id}::uuid, ${other.id}::uuid)
      AND ((t."status" IN ('HELD','SOLD')) <> (t."occupiedSeatId" IS NOT NULL) OR (t."occupiedSeatId" IS NOT NULL AND t."occupiedSeatId" <> t."seatId"))`;
  assert.equal(bad[0].n, 0, 'có vé vi phạm bất biến occupiedSeatId');
}

test('⭐ insertTickets: chèn TẤT CẢ trong một câu, trạng thái HELD, occupiedSeatId = seatId; trùng ghế -> P2002 đi xuyên (truy vấn nội bộ) và KHÔNG vé nào được chèn (tất cả hoặc không)', async () => {
  await reset();
  const a = await mkOrder(user);
  const b = await mkOrder(other);
  const res = await ticketSvc.insertTickets([row(a.id, showtime, 'A2')]);
  assert.equal(res.count, 1);
  const [t] = await ticketsOf(a.id);
  assert.deepEqual([t.status, t.occupiedSeatId, t.showtimeId], ['HELD', seatId('A2'), showtime.id]);

  // b muốn A1 + A2 nhưng A2 đã thuộc vé của a: phải thất bại và A1 cũng KHÔNG được giữ.
  const err = await ticketSvc.insertTickets([row(b.id, showtime, 'A1'), row(b.id, showtime, 'A2')]).then(() => null, (e) => e);
  assert.equal(err.code, 'P2002');
  assert.equal((await ticketsOf(b.id)).length, 0);
  assert.equal(await prisma.ticket.count({ where: { showtimeId: showtime.id } }), 1); // chỉ còn vé của a

  // cùng ghế nhưng SUẤT KHÁC thì không vướng (UNIQUE tính theo (suất, ghế))
  await ticketSvc.insertTickets([row(b.id, showtime2, 'A2')]);
  await assertInvariant();
});

test('⭐ insertTickets: 20 yêu cầu SONG SONG cho cùng một ghế -> đúng 1 thắng (UNIQUE là trọng tài), 19 nhận P2002', async () => {
  await reset();
  const orders = await Promise.all(Array.from({ length: 20 }, (_, i) => mkOrder(i % 2 ? user : other)));
  const results = await Promise.allSettled(orders.map((o) => ticketSvc.insertTickets([row(o.id, showtime, 'A3')])));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.ok(results.filter((r) => r.status === 'rejected').every((r) => r.reason.code === 'P2002'));
  assert.equal(await prisma.ticket.count({ where: { showtimeId: showtime.id, occupiedSeatId: seatId('A3') } }), 1);
  await assertInvariant();
});

test('⭐ cùng tx: tạo đơn + chèn vé trong MỘT transaction không thấy ngoài transaction và bị ROLLBACK khi lỗi (đơn + vé cùng biến mất)', async () => {
  await reset();
  await assert.rejects(() => runInTransaction(async (tx) => {
    const o = await mkOrder(user, {}, tx);
    await ticketSvc.insertTickets([row(o.id, showtime, 'A4')], tx);
    assert.equal(await prisma.order.count({ where: { id: o.id } }), 0, 'ngoài transaction chưa thấy đơn');
    assert.equal(await prisma.ticket.count({ where: { orderId: o.id } }), 0, 'ngoài transaction chưa thấy vé');
    throw new Error('lỗi giữa chừng');
  }), /lỗi giữa chừng/);
  assert.equal(await prisma.order.count({ where: { userId: user.id } }), 0);
  assert.equal(await prisma.ticket.count({ where: { showtimeId: showtime.id, seatId: seatId('A4') } }), 0);
});

test('releaseHeldTicketsOfOrders: chỉ vé HELD của ĐÚNG các đơn đó -> RELEASED + occupiedSeatId NULL (vé còn làm lịch sử); vé SOLD và đơn khác nguyên vẹn; trả số vé đã nhả', async () => {
  await reset();
  const a = await mkOrder(user); const b = await mkOrder(other);
  await ticketSvc.insertTickets([row(a.id, showtime, 'A1'), row(a.id, showtime, 'A2'), row(b.id, showtime, 'A3')]);
  await ticketSvc.markTicketSold({ ticketId: (await ticketsOf(a.id))[1].id, seatId: seatId('A2') }); // A2 đã bán

  assert.equal(await ticketSvc.releaseTicketsOfOrders([a.id]), 1); // chỉ A1
  assert.deepEqual((await ticketsOf(a.id)).map((t) => [t.seatLabel, t.status, t.occupiedSeatId]), [['A1', 'RELEASED', null], ['A2', 'SOLD', seatId('A2')]]);
  assert.equal((await ticketsOf(b.id))[0].status, 'HELD'); // đơn khác nguyên vẹn
  assert.equal(await ticketSvc.releaseTicketsOfOrders([]), 0);
  // ghế A1 đã nhả nên người khác giữ được ngay
  await ticketSvc.insertTickets([row(b.id, showtime, 'A1')]);
  await assertInvariant();
});

test('⭐ releaseExpiredHeldTickets (dọn lười): chỉ vé HELD của ĐƠN QUÁ HẠN trên ĐÚNG các ghế xin; không đụng đơn còn hạn, vé SOLD, ghế khác, suất khác; exceptOrderId được giữ lại', async () => {
  await reset();
  const expired = await mkOrder(user, { expiresAt: past() });
  const live = await mkOrder(other);
  const expiredOtherShow = await mkOrder(user, { expiresAt: past() }); // một đơn chỉ thuộc một suất
  await ticketSvc.insertTickets([row(expired.id, showtime, 'A1'), row(expired.id, showtime, 'A2'), row(expired.id, showtime, 'A3')]);
  await ticketSvc.insertTickets([row(expiredOtherShow.id, showtime2, 'A1')]);
  await ticketSvc.insertTickets([row(live.id, showtime, 'A4')]);
  await ticketSvc.markTicketSold({ ticketId: (await ticketsOf(expired.id))[2].id, seatId: seatId('A3') }); // A3 đã bán (dù đơn quá hạn)

  const now = new Date();
  // xin A1, A3, A4 của suất 1: chỉ A1 (HELD + quá hạn + được xin) bị nhả
  const released = await ticketSvc.releaseExpiredHeldTickets({ showtimeId: showtime.id, seatIds: [seatId('A1'), seatId('A3'), seatId('A4')], now });
  assert.equal(released, 1);
  const state = Object.fromEntries((await prisma.ticket.findMany({ where: { orderId: { in: [expired.id, expiredOtherShow.id, live.id] } } })).map((t) => [`${t.showtimeId === showtime.id ? 1 : 2}${t.seatLabel}`, t.status]));
  assert.deepEqual(state, { '1A1': 'RELEASED', '1A2': 'HELD', '1A3': 'SOLD', '2A1': 'HELD', '1A4': 'HELD' });

  // exceptOrderId: không nhả vé của chính đơn đó
  assert.equal(await ticketSvc.releaseExpiredHeldTickets({ showtimeId: showtime.id, seatIds: [seatId('A2')], now, exceptOrderId: expired.id }), 0);
  assert.equal(await ticketSvc.releaseExpiredHeldTickets({ showtimeId: showtime.id, seatIds: [seatId('A2')], now }), 1);
  await assertInvariant();
});

test('⭐ releaseExpiredHeldTickets KHÔNG BAO GIỜ nhả vé đã SOLD (IPN vừa bán): bán trước rồi dọn -> vẫn SOLD; và 30 lần "bán" đua với "dọn" -> luôn kết thúc SOLD', async () => {
  await reset();
  const o = await mkOrder(user, { expiresAt: past() }); // đơn quá hạn (IPN đến muộn)
  await ticketSvc.insertTickets([row(o.id, showtime, 'A5')]);
  const [t] = await ticketsOf(o.id);
  await ticketSvc.markTicketSold({ ticketId: t.id, seatId: seatId('A5') });
  assert.equal(await ticketSvc.releaseExpiredHeldTickets({ showtimeId: showtime.id, seatIds: [seatId('A5')], now: new Date() }), 0);
  assert.deepEqual((await ticketsOf(o.id)).map((x) => [x.status, x.occupiedSeatId]), [['SOLD', seatId('A5')]]);

  // đua: mỗi vòng một vé HELD quá hạn; một bên bán, một bên dọn. Kết quả hợp lệ duy nhất: SOLD (bán trước -> dọn không đụng; dọn trước -> bán chiếm lại).
  for (let i = 0; i < 30; i++) {
    const x = await mkOrder(user, { expiresAt: past() });
    await ticketSvc.insertTickets([row(x.id, showtime2, 'A5')]);
    const [tx1] = await ticketsOf(x.id);
    await Promise.all([
      ticketSvc.markTicketSold({ ticketId: tx1.id, seatId: seatId('A5') }),
      ticketSvc.releaseExpiredHeldTickets({ showtimeId: showtime2.id, seatIds: [seatId('A5')], now: new Date() }),
    ]);
    assert.equal((await ticketsOf(x.id))[0].status, 'SOLD', `vòng ${i}`);
    await prisma.ticket.deleteMany({ where: { orderId: x.id } });
  }
  await assertInvariant();
});

test('⭐ markTicketSold: HELD -> SOLD; vé đã RELEASED chiếm lại ghế nếu còn trống; ghế đã thuộc vé khác -> P2002 (IPN đến muộn, BR-31) và vé giữ nguyên RELEASED', async () => {
  await reset();
  const a = await mkOrder(user); const b = await mkOrder(other);
  await ticketSvc.insertTickets([row(a.id, showtime, 'A1')]);
  const [ta] = await ticketsOf(a.id);
  const sold = await ticketSvc.markTicketSold({ ticketId: ta.id, seatId: seatId('A1') });
  assert.deepEqual([sold.status, sold.occupiedSeatId], ['SOLD', seatId('A1')]);

  // b: vé RELEASED trên A2 (đơn từng hết hạn) -> chiếm lại được khi A2 còn trống
  await prisma.ticket.create({ data: row(b.id, showtime, 'A2', { status: 'RELEASED' }) });
  const [tb] = await ticketsOf(b.id);
  assert.equal((await ticketSvc.markTicketSold({ ticketId: tb.id, seatId: seatId('A2') })).status, 'SOLD');

  // c: vé RELEASED trên A1 nhưng A1 đã SOLD cho a -> P2002, vé c giữ nguyên
  const c = await mkOrder(other);
  const tc = await prisma.ticket.create({ data: row(c.id, showtime, 'A1', { status: 'RELEASED' }) });
  const err = await ticketSvc.markTicketSold({ ticketId: tc.id, seatId: seatId('A1') }).then(() => null, (e) => e);
  assert.equal(err.code, 'P2002');
  assert.deepEqual((await ticketsOf(c.id)).map((x) => [x.status, x.occupiedSeatId]), [['RELEASED', null]]);
  assert.equal((await ticketsOf(a.id))[0].status, 'SOLD'); // vé người kia không đổi
  await assertInvariant();
});

test('đọc: listOccupiedTicketsOfShowtime (HELD/SOLD, kể cả HELD quá hạn, kèm hạn đơn; bỏ RELEASED), findTakenTickets (SOLD + HELD còn hạn, đúng ghế được hỏi), listTakenTicketShowtimeIds, listTicketsOfOrder', async () => {
  await reset();
  const live = await mkOrder(user); const old = await mkOrder(other, { expiresAt: past() }); const gone = await mkOrder(other);
  await ticketSvc.insertTickets([row(live.id, showtime, 'A1'), row(live.id, showtime, 'A2'), row(old.id, showtime, 'A3')]);
  await ticketSvc.markTicketSold({ ticketId: (await ticketsOf(live.id))[1].id, seatId: seatId('A2') });
  await prisma.ticket.create({ data: row(gone.id, showtime, 'A4', { status: 'RELEASED' }) });
  const liveShow2 = await mkOrder(user);
  await ticketSvc.insertTickets([row(liveShow2.id, showtime2, 'A1')]);

  const occupied = await ticketSvc.listOccupiedTicketsOfShowtime(showtime.id);
  assert.deepEqual(occupied.map((t) => t.seatId).sort(), [seatId('A1'), seatId('A2'), seatId('A3')].sort()); // không có A4 (RELEASED)
  const byseat = Object.fromEntries(occupied.map((t) => [t.seatId, t]));
  assert.equal(byseat[seatId('A3')].status, 'HELD');
  assert.ok(byseat[seatId('A3')].order.expiresAt < new Date()); // service tự xét hạn

  const now = new Date();
  const taken = await ticketSvc.findTakenTickets({ showtimeId: showtime.id, seatIds: [seatId('A1'), seatId('A2'), seatId('A3'), seatId('A4')], now });
  assert.deepEqual(taken.map((t) => t.seatLabel).sort(), ['A1', 'A2']); // A3 quá hạn, A4 đã nhả
  assert.deepEqual((await ticketSvc.findTakenTickets({ showtimeId: showtime.id, seatIds: [seatId('A5')], now })), []);

  const ids = await ticketSvc.listTakenTicketShowtimeIds({ showtimeIds: [showtime.id, showtime2.id], now });
  assert.deepEqual(ids.map((x) => x.showtimeId).sort(), [showtime.id, showtime.id, showtime2.id].sort()); // mỗi vé chiếm ghế một dòng
  assert.deepEqual(await ticketSvc.listTakenTicketShowtimeIds({ showtimeIds: [], now }), []);

  const mine = await ticketSvc.listTicketsOfOrder(live.id);
  assert.deepEqual(mine.map((t) => [t.showtimeId, t.seatId]).sort(), [[showtime.id, seatId('A1')], [showtime.id, seatId('A2')]].sort());
  assert.deepEqual((await ticketSvc.listTicketsOfOrder(liveShow2.id)).map((t) => t.showtimeId), [showtime2.id]);
});

test('⭐ countActiveSalesOfShowtime: vé SOLD, HELD của đơn CÒN HẠN, và vé của đơn REFUND_PENDING tính; HELD của đơn quá hạn, vé RELEASED của đơn đã hủy KHÔNG tính; suất khác không lẫn vào', async () => {
  await reset();
  const now = new Date();
  const count = () => ticketSvc.countActiveSalesOfShowtime({ showtimeId: showtime.id, now });
  assert.equal(await count(), 0);

  const cancelled = await mkOrder(user, { status: 'CANCELLED' });
  await prisma.ticket.create({ data: row(cancelled.id, showtime, 'A1', { status: 'RELEASED' }) });
  const stale = await mkOrder(user, { expiresAt: past() });
  await ticketSvc.insertTickets([row(stale.id, showtime, 'A2')]);
  assert.equal(await count(), 0); // không vé nào chiếm chỗ

  const live = await mkOrder(user);
  await ticketSvc.insertTickets([row(live.id, showtime, 'A3')]);
  assert.equal(await count(), 1);

  const paid = await mkOrder(other, { status: 'PAID' });
  await prisma.ticket.create({ data: row(paid.id, showtime, 'A4', { status: 'SOLD', occupiedSeatId: seatId('A4') }) });
  assert.equal(await count(), 2);

  const refund = await mkOrder(other, { status: 'REFUND_PENDING' });
  await prisma.ticket.create({ data: row(refund.id, showtime, 'A5', { status: 'RELEASED' }) }); // đã nhả nhưng đơn còn chờ hoàn tiền
  assert.equal(await count(), 3);

  const otherShow = await mkOrder(user);
  await ticketSvc.insertTickets([row(otherShow.id, showtime2, 'A1')]); // suất khác
  assert.equal(await count(), 3);
  await assertInvariant();
});

test('⭐ releaseExpiredHeldTickets với exceptOrderId: vé quá hạn của đơn KHÁC vẫn được nhả, vé của chính đơn đó thì giữ lại (IPN đến muộn)', async () => {
  await reset();
  const mine = await mkOrder(user, { expiresAt: past() });
  const theirs = await mkOrder(other, { expiresAt: past() });
  await ticketSvc.insertTickets([row(mine.id, showtime, 'A1')]);
  await ticketSvc.insertTickets([row(theirs.id, showtime, 'A2')]);
  const released = await ticketSvc.releaseExpiredHeldTickets({ showtimeId: showtime.id, seatIds: [seatId('A1'), seatId('A2')], now: new Date(), exceptOrderId: mine.id });
  assert.equal(released, 1);
  assert.equal((await ticketsOf(mine.id))[0].status, 'HELD');
  assert.equal((await ticketsOf(theirs.id))[0].status, 'RELEASED');
  await assertInvariant();
});
