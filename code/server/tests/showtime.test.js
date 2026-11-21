// Cần dữ liệu mẫu: chạy `npm run db:seed` trước.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { default: app } = await import('../src/app.js');
const { prisma } = await import('../src/config/prisma.js');
const { isOpenForSale } = await import('../src/services/showtime.service.js');

let server;
let base;
let showtime;
let user;
const minute = 60_000;

before(async () => {
  server = app.listen(0);
  base = `http://localhost:${server.address().port}/api/v1`;
  showtime = await prisma.showtime.findFirst({
    where: { startTime: { gt: new Date(Date.now() + 60 * minute) }, status: 'OPEN', room: { name: { startsWith: 'Phòng ' }, seats: { some: {} } } },
    orderBy: { startTime: 'asc' },
  });
  user = await prisma.user.create({
    data: { email: `test-seat-${Date.now()}@example.com`, passwordHash: 'x', fullName: 'Test ghế' },
  });
});

after(async () => {
  await prisma.order.deleteMany({ where: { userId: user.id } }); // Ticket xóa theo (cascade)
  await prisma.user.delete({ where: { id: user.id } });
  server.close();
  await prisma.$disconnect();
});

const get = async (path) => {
  const res = await fetch(base + path);
  return { status: res.status, json: await res.json() };
};

test('isOpenForSale: BR-04 — còn > 15 phút mới bán; suất CANCELLED thì không', () => {
  const now = new Date('2026-10-02T10:00:00Z');
  const at = (min, status = 'OPEN') => ({ status, startTime: new Date(now.getTime() + min * minute) });
  assert.equal(isOpenForSale(at(16), now), true);
  assert.equal(isOpenForSale(at(15), now), false); // đúng 15 phút: đã đóng
  assert.equal(isOpenForSale(at(-5), now), false); // đã chiếu
  assert.equal(isOpenForSale(at(120, 'CANCELLED'), now), false);
});

test('GET /showtimes/:id trả đủ phim, rạp, phòng', async () => {
  const r = await get(`/showtimes/${showtime.id}`);
  assert.equal(r.status, 200);
  assert.ok(r.json.data.movie.title && r.json.data.cinema.name && r.json.data.room.name);
  assert.equal(r.json.data.isOpenForSale, true);
});

test('id không tồn tại -> 404; id sai định dạng -> 400', async () => {
  assert.equal((await get('/showtimes/00000000-0000-4000-8000-000000000000')).json.error.code, 'NOT_FOUND');
  assert.equal((await get('/showtimes/abc')).json.error.code, 'VALIDATION_ERROR');
});

test('sơ đồ ghế: đủ 96 ghế, giá đúng BR-11/13, ghế đôi hiển thị giá cả cặp', async () => {
  const { seats, rows } = (await get(`/showtimes/${showtime.id}/seats`)).json.data;
  assert.equal(seats.length, 96);
  assert.deepEqual(rows, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  const price = (label) => seats.find((s) => s.label === label).price;
  assert.equal(price('D1') - price('A1'), 15000); // VIP = thường + 15.000
  assert.equal(price('H1'), price('H2')); // hai ghế của một cặp cùng hiện giá cặp
  assert.equal(price('H1'), showtime.basePrice * 2 + 20000);
  assert.ok(seats.every((s) => s.status === 'AVAILABLE'));
});

test('⭐ trạng thái ghế: HELD còn hạn -> HELD, HELD quá hạn -> AVAILABLE, SOLD -> SOLD', async () => {
  const seats = await prisma.seat.findMany({ where: { roomId: showtime.roomId, row: 'A' }, orderBy: { number: 'asc' } });
  const [held, expired, sold] = seats;
  // Hạn giữ ghế nằm ở ĐƠN (docs/03 v1.3): đơn còn hạn giữ vé HELD -> HELD; đơn quá hạn -> vé HELD coi như trống; vé SOLD -> SOLD.
  const mkOrder = (tag, seat, ticketStatus, expiresAt, extra = {}) => prisma.order.create({
    data: {
      code: `T${tag}${Date.now()}`.slice(-10), userId: user.id, expiresAt, seatTotal: 0, total: 0, ...extra,
      tickets: { create: [{ showtimeId: showtime.id, seatId: seat.id, seatLabel: `${seat.row}${seat.number}`, seatType: seat.type, price: 0, status: ticketStatus, occupiedSeatId: seat.id }] },
    },
  });
  await mkOrder('H', held, 'HELD', new Date(Date.now() + 5 * minute));
  await mkOrder('E', expired, 'HELD', new Date(Date.now() - minute));
  await mkOrder('S', sold, 'SOLD', new Date(Date.now() + 10 * minute), { status: 'PAID', paidAt: new Date() });

  const map = (await get(`/showtimes/${showtime.id}/seats`)).json.data.seats;
  const status = (seat) => map.find((s) => s.id === seat.id).status;
  assert.equal(status(held), 'HELD');
  assert.equal(status(expired), 'AVAILABLE'); // dọn lười: không cần chờ cron
  assert.equal(status(sold), 'SOLD');
});

test('ghế hỏng (isActive=false) -> UNAVAILABLE', async () => {
  const seat = await prisma.seat.findFirst({ where: { roomId: showtime.roomId, row: 'B', number: 1 } });
  await prisma.seat.update({ where: { id: seat.id }, data: { isActive: false } });
  try {
    const map = (await get(`/showtimes/${showtime.id}/seats`)).json.data.seats;
    assert.equal(map.find((s) => s.id === seat.id).status, 'UNAVAILABLE');
  } finally {
    await prisma.seat.update({ where: { id: seat.id }, data: { isActive: true } });
  }
});

test('lịch chiếu theo phim: nhóm rạp -> định dạng; date sai -> 400', async () => {
  const room = await prisma.room.findUnique({ where: { id: showtime.roomId }, include: { cinema: true } });
  const date = new Date(showtime.startTime.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
  const r = await get(`/movies/${showtime.movieId}/showtimes?date=${date}&cityId=${room.cinema.cityId}`);
  assert.equal(r.status, 200);
  const cinema = r.json.data.cinemas.find((c) => c.cinema.id === room.cinemaId);
  const ids = cinema.groups.flatMap((g) => g.showtimes.map((s) => s.id));
  assert.ok(ids.includes(showtime.id));
  assert.equal((await get(`/movies/${showtime.movieId}/showtimes?date=3-10&cityId=${room.cinema.cityId}`)).status, 400);
});
