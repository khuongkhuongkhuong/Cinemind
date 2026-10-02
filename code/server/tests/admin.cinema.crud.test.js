// Tạo / sửa rạp (admin) và lịch chiếu theo rạp (công khai). Cần dữ liệu mẫu: chạy `npm run db:seed` trước.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { prisma } = await import('../src/config/prisma.js');
const showtimeSvc = await import('../src/services/showtime.service.js');
const { default: app } = await import('../src/app.js');
const { createRoleUsers } = await import('./helpers/role-users.js');

const minute = 60_000;
const DAY = 24 * 60 * minute;
const RUN = Date.now();
let roles; let server; let base; let city; let customer;
const cinemaIds = [];

const call = (method, path, { role = 'ADMIN', body } = {}) => fetch(base + path, {
  method,
  headers: { ...(role && { Authorization: `Bearer ${roles.token(role)}` }), ...(body && { 'Content-Type': 'application/json' }) },
  body: body && JSON.stringify(body),
});
const mkCinema = async (extra = {}) => {
  const res = await call('POST', '/admin/cinemas', { body: { cityId: city.id, name: `TestCinema-${RUN}-${cinemaIds.length}`, address: '1 Test', ...extra } });
  const json = await res.json();
  if (json.data) cinemaIds.push(json.data.id);
  return { res, data: json.data, json };
};

before(async () => {
  roles = await createRoleUsers(prisma, `cinc${RUN}`);
  city = await prisma.city.findFirst();
  customer = await prisma.user.create({ data: { email: `test-cinc-${RUN}@example.com`, passwordHash: 'x', fullName: 'Test' } });
  server = app.listen(0);
  base = `http://localhost:${server.address().port}/api/v1`;
});
after(async () => {
  server.close();
  const showtimes = await prisma.showtime.findMany({ where: { room: { cinemaId: { in: cinemaIds } } }, select: { id: true } });
  const ids = showtimes.map((s) => s.id);
  await prisma.order.deleteMany({ where: { showtimeId: { in: ids } } });
  await prisma.showtime.deleteMany({ where: { id: { in: ids } } });
  await prisma.room.deleteMany({ where: { cinemaId: { in: cinemaIds } } });
  await prisma.cinema.deleteMany({ where: { id: { in: cinemaIds } } });
  await prisma.user.delete({ where: { id: customer.id } });
  await roles.cleanup();
  await prisma.$disconnect();
});

test('phân quyền: không token 401; USER / STAFF 403 (tạo & sửa rạp)', async () => {
  for (const [m, p] of [['POST', '/admin/cinemas'], ['PUT', '/admin/cinemas/00000000-0000-4000-8000-000000000000']]) {
    assert.equal((await call(m, p, { role: null, body: {} })).status, 401);
    assert.equal((await call(m, p, { role: 'USER', body: {} })).status, 403);
    assert.equal((await call(m, p, { role: 'STAFF', body: {} })).status, 403);
  }
});

test('tạo rạp: 201, có thành phố, rooms rỗng, mặc định đang hoạt động, hiện trong danh sách admin', async () => {
  const { res, data } = await mkCinema({ phone: '0912345678' });
  assert.equal(res.status, 201);
  assert.deepEqual([data.isActive, data.rooms, data.city.id, data.phone], [true, [], city.id, '0912345678']);
  const list = (await (await call('GET', '/admin/cinemas')).json()).data;
  assert.ok(list.some((c) => c.id === data.id));
});

test('tạo rạp: thiếu / sai dữ liệu -> 400; cityId không tồn tại -> 400 gắn đúng ô; trường lạ (mass assignment) bị từ chối', async () => {
  assert.equal((await call('POST', '/admin/cinemas', { body: { cityId: city.id, name: '', address: 'x' } })).status, 400);
  assert.equal((await call('POST', '/admin/cinemas', { body: { cityId: city.id, name: 'a', address: 'x', phone: '123' } })).status, 400);
  const noCity = await call('POST', '/admin/cinemas', { body: { cityId: '00000000-0000-4000-8000-000000000000', name: 'a', address: 'x' } });
  assert.equal(noCity.status, 400);
  assert.ok((await noCity.json()).error.details.fields.cityId);
  assert.equal((await call('POST', '/admin/cinemas', { body: { cityId: city.id, name: 'a', address: 'x', id: '00000000-0000-4000-8000-000000000001' } })).status, 400);
});

test('sửa rạp: đổi một phần, các trường khác giữ nguyên; body rỗng / trường lạ -> 400; không tồn tại -> 404', async () => {
  const { data } = await mkCinema({ phone: '0912345678' });
  const res = await call('PUT', `/admin/cinemas/${data.id}`, { body: { name: 'Tên mới', phone: null } });
  assert.equal(res.status, 200);
  const updated = (await res.json()).data;
  assert.deepEqual([updated.name, updated.phone, updated.address, updated.city.id], ['Tên mới', null, '1 Test', city.id]);
  assert.equal((await call('PUT', `/admin/cinemas/${data.id}`, { body: {} })).status, 400);
  assert.equal((await call('PUT', `/admin/cinemas/${data.id}`, { body: { rooms: [] } })).status, 400);
  assert.equal((await call('PUT', '/admin/cinemas/00000000-0000-4000-8000-000000000000', { body: { name: 'x' } })).status, 404);
});

test('⭐ tắt rạp còn suất sắp chiếu đã có người mua -> 409 RESOURCE_IN_USE; đơn PENDING hết hạn / suất đã hủy thì không chặn', async () => {
  const { data: cinema } = await mkCinema();
  const room = await prisma.room.create({ data: { cinemaId: cinema.id, name: `TestRoom-${RUN}` } });
  const movie = await prisma.movie.findFirst({ where: { status: 'NOW_SHOWING' } });
  const T0 = new Date(Math.ceil((Date.now() + 70 * DAY) / (60 * minute)) * 60 * minute);
  const st = await showtimeSvc.createShowtime({ movieId: movie.id, roomId: room.id, startTime: T0, format: 'F2D', audio: 'SUBTITLE' });
  const order = await prisma.order.create({
    data: { code: `C${RUN}`.slice(-10), userId: customer.id, showtimeId: st.id, status: 'PAID', paidAt: new Date(), expiresAt: new Date(Date.now() + 10 * minute), seatTotal: 0, total: 0 },
  });

  const blocked = await call('PUT', `/admin/cinemas/${cinema.id}`, { body: { isActive: false } });
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).error.code, 'RESOURCE_IN_USE');
  assert.equal((await prisma.cinema.findUnique({ where: { id: cinema.id } })).isActive, true);

  await prisma.order.update({ where: { id: order.id }, data: { status: 'PENDING', paidAt: null, expiresAt: new Date(Date.now() - minute) } });
  const ok = await call('PUT', `/admin/cinemas/${cinema.id}`, { body: { isActive: false } });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).data.isActive, false);
});

test('lịch chiếu theo rạp (công khai): nhóm theo phim -> định dạng; chỉ suất OPEN trong ngày VN; rạp tắt / không có -> 404; ngày sai -> 400', async () => {
  const { data: cinema } = await mkCinema();
  const room = await prisma.room.create({ data: { cinemaId: cinema.id, name: `TestRoom-${RUN}-pub` } });
  const [m1, m2] = await prisma.movie.findMany({ where: { status: 'NOW_SHOWING' }, take: 2, orderBy: { title: 'asc' } });
  // 10:00 giờ VN (03:00Z) của một ngày xa trong tương lai; các suất cách nhau đủ xa để không trùng giờ.
  const day = new Date(Date.now() + 80 * DAY).toISOString().slice(0, 10);
  const at = (hhmmVn) => new Date(Date.parse(`${day}T${hhmmVn}:00+07:00`));
  const mk = (movie, hhmm, extra = {}) => showtimeSvc.createShowtime({ movieId: movie.id, roomId: room.id, startTime: at(hhmm), format: 'F2D', audio: 'SUBTITLE', ...extra });
  await mk(m1, '09:00');
  await mk(m1, '12:00');
  await mk(m1, '15:00', { format: 'IMAX' });
  await mk(m2, '18:00');
  const cancelled = await mk(m2, '21:00');
  await showtimeSvc.cancelShowtime({ showtimeId: cancelled.id });

  const res = await fetch(`${base}/cinemas/${cinema.id}/showtimes?date=${day}`); // KHÔNG cần token
  assert.equal(res.status, 200);
  const data = (await res.json()).data;
  assert.equal(data.date, day);
  assert.equal(data.cinema.id, cinema.id);
  assert.equal(data.movies.length, 2);
  const g1 = data.movies.find((m) => m.movie.id === m1.id);
  assert.equal(g1.groups.length, 2); // F2D và IMAX
  assert.equal(g1.groups.find((g) => g.format === 'F2D').showtimes.length, 2);
  assert.ok(g1.movie.slug && g1.movie.durationMin);
  const g2 = data.movies.find((m) => m.movie.id === m2.id);
  assert.equal(g2.groups[0].showtimes.length, 1); // suất đã hủy không hiện
  const times = g1.groups.find((g) => g.format === 'F2D').showtimes.map((s) => s.startTime);
  assert.deepEqual(times, [...times].sort()); // xếp theo giờ

  const other = new Date(Date.parse(`${day}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
  assert.deepEqual((await (await fetch(`${base}/cinemas/${cinema.id}/showtimes?date=${other}`)).json()).data.movies, []);

  assert.equal((await fetch(`${base}/cinemas/00000000-0000-4000-8000-000000000000/showtimes?date=${day}`)).status, 404);
  assert.equal((await fetch(`${base}/cinemas/${cinema.id}/showtimes`)).status, 400);
  assert.equal((await fetch(`${base}/cinemas/${cinema.id}/showtimes?date=abc`)).status, 400);

  await call('PUT', `/admin/cinemas/${cinema.id}`, { body: { isActive: false } });
  assert.equal((await fetch(`${base}/cinemas/${cinema.id}/showtimes?date=${day}`)).status, 404); // rạp tắt: biến khỏi khách
});

test('tắt rạp: suất ĐÃ HỦY hoặc ĐÃ CHIẾU xong (dù có đơn đã thanh toán) không chặn việc tắt', async () => {
  const { data: cinema } = await mkCinema();
  const room = await prisma.room.create({ data: { cinemaId: cinema.id, name: `TestRoom-${RUN}-old` } });
  const movie = await prisma.movie.findFirst({ where: { status: 'NOW_SHOWING' } });
  const mkShowtime = (start, status) => prisma.showtime.create({
    data: { movieId: movie.id, roomId: room.id, startTime: start, endTime: new Date(start.getTime() + 2 * 60 * minute), format: 'F2D', audio: 'SUBTITLE', basePrice: 90000, status },
  });
  const paid = (showtimeId, n) => prisma.order.create({
    data: { code: `D${RUN}${n}`.slice(-10), userId: customer.id, showtimeId, status: 'PAID', paidAt: new Date(), expiresAt: new Date(), seatTotal: 0, total: 0 },
  });
  const cancelled = await mkShowtime(new Date(Date.now() + 90 * DAY), 'CANCELLED');
  const past = await mkShowtime(new Date(Date.now() - 3 * DAY), 'OPEN');
  await paid(cancelled.id, 1);
  await paid(past.id, 2);
  const res = await call('PUT', `/admin/cinemas/${cinema.id}`, { body: { isActive: false } });
  assert.equal(res.status, 200);
});
