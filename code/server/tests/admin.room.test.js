// Quản lý phòng chiếu (FR-32a, docs/04 v1.29). Cần dữ liệu mẫu: chạy `npm run db:seed` trước.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { prisma } = await import('../src/config/prisma.js');
const showtimeSvc = await import('../src/services/showtime.service.js');
const orderSvc = await import('../src/services/order.service.js');
const { buildTemplateSeats } = await import('../src/services/seat.service.js');
const { default: app } = await import('../src/app.js');
const { createRoleUsers } = await import('./helpers/role-users.js');
const { createOrder } = await import('./helpers/orders.js');

const DAY = 24 * 60 * 60_000;
const RUN = Date.now();
const NO_ID = '00000000-0000-4000-8000-000000000000';
let roles; let server; let base; let cinema; let movie; let customer;

const call = (method, path, { role = 'ADMIN', body } = {}) => fetch(base + path, {
  method,
  headers: { ...(role && { Authorization: `Bearer ${roles.token(role)}` }), ...(body && { 'Content-Type': 'application/json' }) },
  body: body && JSON.stringify(body),
});
let roomNo = 0;
async function mkRoom(extra = {}) {
  const res = await call('POST', `/admin/cinemas/${cinema.id}/rooms`, { body: { name: `Phòng ${++roomNo}`, template: 'SMALL', ...extra } });
  const json = await res.json();
  return { res, json, data: json.data };
}
const mkShowtime = (roomId, daysAhead = 3) => showtimeSvc.createShowtime({
  movieId: movie.id, roomId, startTime: new Date(Date.now() + daysAhead * DAY), format: 'F2D', audio: 'SUBTITLE', basePrice: 75000,
});
const oneSeat = (roomId) => prisma.seat.findFirst({ where: { roomId, type: 'STANDARD' } });

before(async () => {
  roles = await createRoleUsers(prisma, `room${RUN}`);
  const city = await prisma.city.findFirst();
  cinema = await prisma.cinema.create({ data: { cityId: city.id, name: `RoomCinema-${RUN}`, address: '1 Test' } });
  movie = await prisma.movie.create({
    data: {
      title: `Room Movie ${RUN}`, slug: `room-movie-${RUN}`, searchKey: `room movie ${RUN}`, description: 'Mô tả thử', // các test khác bỏ qua phim có mô tả này
      durationMin: 100, ageRating: 'P', status: 'NOW_SHOWING', releaseDate: new Date('2026-01-01'),
    },
  });
  customer = await prisma.user.create({ data: { email: `test-room-${RUN}@example.com`, passwordHash: 'x', fullName: 'Test' } });
  server = app.listen(0);
  base = `http://localhost:${server.address().port}/api/v1`;
});
after(async () => {
  server.close();
  const showtimes = await prisma.showtime.findMany({ where: { room: { cinemaId: cinema.id } }, select: { id: true } });
  const ids = showtimes.map((s) => s.id);
  await prisma.order.deleteMany({ where: { OR: [{ userId: customer.id }, { tickets: { some: { showtimeId: { in: ids } } } }] } });
  await prisma.showtime.deleteMany({ where: { id: { in: ids } } });
  await prisma.seat.deleteMany({ where: { room: { cinemaId: cinema.id } } });
  await prisma.room.deleteMany({ where: { cinemaId: cinema.id } });
  await prisma.cinema.delete({ where: { id: cinema.id } });
  await prisma.movie.delete({ where: { id: movie.id } });
  await prisma.user.delete({ where: { id: customer.id } });
  await roles.cleanup();
  await prisma.$disconnect();
});

test('mẫu sơ đồ ghế: đúng số ghế, hàng cuối là ghế đôi đủ cặp, không trùng vị trí', () => {
  for (const [template, total, standard] of [['SMALL', 60, 20], ['MEDIUM', 96, 36], ['LARGE', 140, 42]]) {
    const seats = buildTemplateSeats(template);
    assert.equal(seats.length, total);
    assert.equal(new Set(seats.map((s) => `${s.row}${s.number}`)).size, total);
    assert.equal(seats.filter((s) => s.type === 'STANDARD').length, standard);
    const couples = seats.filter((s) => s.type === 'COUPLE');
    assert.deepEqual([...new Set(couples.map((s) => s.row))], [seats.at(-1).row]);
    const pairs = Map.groupBy(couples, (s) => s.pairCode);
    assert.ok([...pairs.values()].every((p) => p.length === 2));
    assert.ok(seats.filter((s) => s.type !== 'COUPLE').every((s) => s.pairCode === null));
  }
});

test('⭐ phân quyền: không token 401; USER / STAFF 403 (thêm, sửa, xóa phòng)', async () => {
  for (const [m, p] of [['POST', `/admin/cinemas/${NO_ID}/rooms`], ['PUT', `/admin/rooms/${NO_ID}`], ['DELETE', `/admin/rooms/${NO_ID}`]]) {
    assert.equal((await call(m, p, { role: null })).status, 401);
    assert.equal((await call(m, p, { role: 'USER' })).status, 403);
    assert.equal((await call(m, p, { role: 'STAFF' })).status, 403);
  }
});

test('thêm phòng: 201, có đủ ghế theo mẫu, hiện trong danh sách và tạo được suất', async () => {
  const { res, data } = await mkRoom({ template: 'LARGE' });
  assert.equal(res.status, 201);
  assert.deepEqual({ ...data, id: undefined }, { id: undefined, name: data.name, isActive: true, seatCount: 140 });
  assert.equal(await prisma.seat.count({ where: { roomId: data.id } }), 140);
  const list = (await (await call('GET', '/admin/cinemas')).json()).data;
  assert.ok(list.find((c) => c.id === cinema.id).rooms.some((r) => r.id === data.id && r.seatCount === 140));
  assert.ok((await mkShowtime(data.id)).id);
});

test('thêm phòng: trùng tên -> 400 ở ô name và không để lại phòng / ghế thừa; dữ liệu sai -> 400; rạp lạ -> 404', async () => {
  const { data } = await mkRoom();
  const seatsBefore = await prisma.seat.count({ where: { room: { cinemaId: cinema.id } } });
  const dup = await mkRoom({ name: data.name });
  assert.equal(dup.res.status, 400);
  assert.ok(dup.json.error.details.fields.name);
  assert.equal(await prisma.seat.count({ where: { room: { cinemaId: cinema.id } } }), seatsBefore);
  for (const body of [{ name: '', template: 'SMALL' }, { name: 'A', template: 'HUGE' }, { name: 'B' }, { name: 'C', template: 'SMALL', seats: 5 }]) {
    assert.equal((await call('POST', `/admin/cinemas/${cinema.id}/rooms`, { body })).status, 400, JSON.stringify(body));
  }
  assert.equal((await call('POST', `/admin/cinemas/${NO_ID}/rooms`, { body: { name: 'A', template: 'SMALL' } })).status, 404);
});

test('đổi tên phòng; trùng tên phòng khác -> 400; body rỗng / trường lạ -> 400; phòng lạ -> 404', async () => {
  const a = (await mkRoom()).data;
  const b = (await mkRoom()).data;
  const renamed = await call('PUT', `/admin/rooms/${a.id}`, { body: { name: `VIP ${RUN}` } });
  assert.equal(renamed.status, 200);
  assert.deepEqual((await renamed.json()).data, { id: a.id, name: `VIP ${RUN}`, isActive: true, seatCount: 60 });
  const dup = await call('PUT', `/admin/rooms/${a.id}`, { body: { name: b.name } });
  assert.equal(dup.status, 400);
  assert.ok((await dup.json()).error.details.fields.name);
  assert.equal((await call('PUT', `/admin/rooms/${a.id}`, { body: {} })).status, 400);
  assert.equal((await call('PUT', `/admin/rooms/${a.id}`, { body: { cinemaId: cinema.id } })).status, 400);
  assert.equal((await call('PUT', `/admin/rooms/${NO_ID}`, { body: { name: 'X' } })).status, 404);
});

test('⭐ ngưng phòng: suất ẩn khỏi lịch khách, đóng bán, không giữ ghế / tạo suất được; mở lại thì hiện như cũ', async () => {
  const room = (await mkRoom()).data;
  const showtime = await mkShowtime(room.id);
  const date = new Date(showtime.startTime.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
  const inSchedule = async () => (await showtimeSvc.listShowtimesByCinema({ cinemaId: cinema.id, date }))
    .movies.some((m) => m.groups.some((g) => g.showtimes.some((s) => s.id === showtime.id)));
  const inMovie = async () => (await showtimeSvc.listShowtimesByMovie({ movieId: movie.id, date, cityId: cinema.cityId }))
    .cinemas.some((c) => c.groups.some((g) => g.showtimes.some((s) => s.id === showtime.id)));
  const seat = await oneSeat(room.id);
  assert.ok(await inSchedule());
  assert.ok(await inMovie());

  assert.equal((await call('PUT', `/admin/rooms/${room.id}`, { body: { isActive: false } })).status, 200);
  assert.equal(await inSchedule(), false);
  assert.equal(await inMovie(), false);
  assert.equal((await showtimeSvc.getShowtime({ showtimeId: showtime.id })).isOpenForSale, false);
  await assert.rejects(orderSvc.holdSeats({ userId: customer.id, showtimeId: showtime.id, seatIds: [seat.id] }), { code: 'SHOWTIME_CLOSED' });
  await assert.rejects(mkShowtime(room.id, 5), { code: 'NOT_FOUND' });

  assert.equal((await call('PUT', `/admin/rooms/${room.id}`, { body: { isActive: true } })).status, 200);
  assert.ok(await inSchedule());
  assert.equal((await showtimeSvc.getShowtime({ showtimeId: showtime.id })).isOpenForSale, true);
});

test('⭐ rạp đã tắt: giữ ghế qua link suất chiếu cũng bị chặn (SHOWTIME_CLOSED)', async () => {
  const room = (await mkRoom()).data;
  const showtime = await mkShowtime(room.id);
  const seat = await oneSeat(room.id);
  await prisma.cinema.update({ where: { id: cinema.id }, data: { isActive: false } });
  try {
    assert.equal((await showtimeSvc.getShowtime({ showtimeId: showtime.id })).isOpenForSale, false);
    await assert.rejects(orderSvc.holdSeats({ userId: customer.id, showtimeId: showtime.id, seatIds: [seat.id] }), { code: 'SHOWTIME_CLOSED' });
  } finally {
    await prisma.cinema.update({ where: { id: cinema.id }, data: { isActive: true } });
  }
});

test('phản hồi công khai của suất không lộ cờ nội bộ isActive của rạp / phòng', async () => {
  const showtime = await mkShowtime((await mkRoom()).data.id);
  const detail = await showtimeSvc.getShowtime({ showtimeId: showtime.id });
  assert.deepEqual(Object.keys(detail.cinema).sort(), ['id', 'name']);
  assert.deepEqual(Object.keys(detail.room).sort(), ['id', 'name']);
});

test('⭐ không ngưng được phòng còn suất sắp chiếu đã có người mua / giữ vé; đơn hết hạn thì ngưng được', async () => {
  const room = (await mkRoom()).data;
  const showtime = await mkShowtime(room.id);
  const order = await createOrder({
    data: {
      code: `R${RUN}${process.pid}`.slice(-10), userId: customer.id, showtimeId: showtime.id, status: 'PENDING',
      seatId: (await oneSeat(room.id)).id, expiresAt: new Date(Date.now() + 5 * 60_000), seatTotal: 0, total: 0,
    },
  });
  const blocked = await call('PUT', `/admin/rooms/${room.id}`, { body: { isActive: false } });
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).error.code, 'RESOURCE_IN_USE');
  assert.equal((await prisma.room.findUnique({ where: { id: room.id } })).isActive, true);

  await prisma.order.update({ where: { id: order.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
  assert.equal((await call('PUT', `/admin/rooms/${room.id}`, { body: { isActive: false } })).status, 200);
});

test('xóa phòng chưa từng có suất: 204, mất cả ghế, và được ghi vào nhật ký (FR-39)', async () => {
  const room = (await mkRoom()).data;
  const res = await call('DELETE', `/admin/rooms/${room.id}`);
  assert.equal(res.status, 204);
  assert.equal(await prisma.room.findUnique({ where: { id: room.id } }), null);
  assert.equal(await prisma.seat.count({ where: { roomId: room.id } }), 0);
  assert.equal((await call('DELETE', `/admin/rooms/${room.id}`)).status, 404);

  let log = null;
  for (let i = 0; i < 40 && !log; i++) { // nhật ký ghi SAU khi trả phản hồi
    log = await prisma.auditLog.findFirst({ where: { entityId: room.id, action: 'DELETE /admin/rooms/:id' } });
    if (!log) await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(log, 'thao tác xóa phải có trong nhật ký');
  assert.equal(log.entityType, 'rooms');
});

test('⭐ phòng đã từng có suất (kể cả đã hủy) -> không xóa được, dữ liệu còn nguyên', async () => {
  const room = (await mkRoom()).data;
  const showtime = await mkShowtime(room.id);
  await showtimeSvc.cancelShowtime({ showtimeId: showtime.id });
  const res = await call('DELETE', `/admin/rooms/${room.id}`);
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error.code, 'RESOURCE_IN_USE');
  assert.equal(await prisma.seat.count({ where: { roomId: room.id } }), 60);
});
