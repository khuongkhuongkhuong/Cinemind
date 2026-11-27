// Tạo suất chiếu hàng loạt (FR-31b) và số ghế đã đặt trên danh sách quản trị (FR-31a).
// Cần dữ liệu mẫu: chạy `npm run db:seed` trước.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { prisma } = await import('../src/config/prisma.js');
const svc = await import('../src/services/showtime.service.js');
const { getBasePrice } = await import('../src/services/pricing.service.js');
const { default: app } = await import('../src/app.js');
const { createRoleUsers } = await import('./helpers/role-users.js');
const { createOrder } = await import('./helpers/orders.js');

const RUN = Date.now();
const DAY = 86_400_000;
const dayKey = (offset) => new Date(Date.now() + 7 * 3600_000 + offset * DAY).toISOString().slice(0, 10);
const D1 = dayKey(90); const D2 = dayKey(91);
const vn = (date, time) => new Date(`${date}T${time}:00+07:00`);

let movie; let ended; let room; let customer; let roles; let server; let base;
const body = (extra = {}) => ({ movieId: movie.id, roomId: room.id, dates: [D1, D2], times: ['09:00', '14:00'], format: 'F2D', audio: 'SUBTITLE', ...extra });
const results = (r) => r.items.map((i) => `${i.date === D1 ? 'D1' : 'D2'} ${i.time} ${i.result}`);
const countInRoom = () => prisma.showtime.count({ where: { roomId: room.id } });
const failCode = (p) => p.then(() => null, (e) => e.code);

before(async () => {
  const mk = (suffix, status) => prisma.movie.create({
    data: { title: `TestBulk ${suffix} ${RUN}`, slug: `test-bulk-${suffix}-${RUN}`, searchKey: `testbulk ${suffix} ${RUN}`, description: 'Mô tả thử', durationMin: 105, ageRating: 'P', releaseDate: new Date(), status },
  });
  movie = await mk('a', 'NOW_SHOWING'); // 105 phút + 15 dọn = 2 giờ
  ended = await mk('b', 'ENDED');
  const cinema = await prisma.cinema.findFirst({ where: { name: { startsWith: 'Cinemind' }, isActive: true }, orderBy: { name: 'asc' } });
  room = await prisma.room.create({ data: { cinemaId: cinema.id, name: `TestRoom-${RUN}-bulk` } });
  customer = await prisma.user.create({ data: { email: `test-bulk-${RUN}@example.com`, passwordHash: 'x', fullName: 'Test' } });
  roles = await createRoleUsers(prisma, `blk${RUN}`);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/v1/admin/showtimes`;
});

beforeEach(async () => {
  await prisma.order.deleteMany({ where: { userId: customer.id } });
  await prisma.showtime.deleteMany({ where: { roomId: room.id } });
});

after(async () => {
  await prisma.order.deleteMany({ where: { userId: customer.id } });
  await prisma.showtime.deleteMany({ where: { roomId: room.id } });
  await prisma.seat.deleteMany({ where: { roomId: room.id } });
  await prisma.room.delete({ where: { id: room.id } });
  await prisma.movie.deleteMany({ where: { id: { in: [movie.id, ended.id] } } });
  await prisma.auditLog.deleteMany({ where: { actorId: roles.users.ADMIN.id } });
  await prisma.user.delete({ where: { id: customer.id } });
  await roles.cleanup();
  server.close();
  await prisma.$disconnect();
});

test('xem trước: mỗi (ngày × giờ) một suất, đúng giờ Việt Nam và giá theo bảng giá, KHÔNG ghi gì', async () => {
  const r = await svc.createShowtimesBulk(body({ dryRun: true }));
  assert.deepEqual([r.dryRun, r.okCount, r.skippedCount], [true, 4, 0]);
  assert.deepEqual(results(r), ['D1 09:00 OK', 'D1 14:00 OK', 'D2 09:00 OK', 'D2 14:00 OK']);
  assert.equal(r.items[0].startTime.getTime(), vn(D1, '09:00').getTime());
  assert.equal(r.items[0].endTime.getTime() - r.items[0].startTime.getTime(), 120 * 60_000);
  for (const i of r.items) assert.equal(i.basePrice, (await getBasePrice({ format: 'F2D', startTime: i.startTime })).basePrice);
  assert.equal(await countInRoom(), 0);
});

test('tạo thật: ghi đúng các suất; giá gửi lên được dùng; ngày / giờ lặp lại chỉ tính một lần', async () => {
  const r = await svc.createShowtimesBulk(body({ dates: [D2, D1, D1], times: ['14:00', '09:00', '09:00'], basePrice: 77_000 }));
  assert.equal(r.okCount, 4);
  const rows = await prisma.showtime.findMany({ where: { roomId: room.id }, orderBy: { startTime: 'asc' } });
  assert.equal(rows.length, 4);
  assert.ok(rows.every((s) => s.basePrice === 77_000 && s.status === 'OPEN'));
});

test('⭐ trùng suất đang có thì BỎ QUA suất đó (kèm suất gây trùng), vẫn tạo các suất còn lại; nối đuôi không tính là trùng', async () => {
  const existing = await svc.createShowtime({ movieId: movie.id, roomId: room.id, startTime: vn(D1, '10:00'), format: 'F2D', audio: 'SUBTITLE' }); // [10:00, 12:00)
  const r = await svc.createShowtimesBulk(body({ dates: [D1], times: ['08:00', '09:00', '11:59', '12:00'] }));
  assert.deepEqual(results(r), ['D1 08:00 OK', 'D1 09:00 OVERLAP', 'D1 11:59 OVERLAP', 'D1 12:00 OK']);
  assert.equal(r.items[1].conflict.showtimeId, existing.id);
  assert.equal(r.items[1].conflict.movieTitle, movie.title);
  assert.equal(await countInRoom(), 3);
});

test('suất đã hủy không chặn; hai giờ trong CÙNG LÔ đè nhau thì giữ suất sớm hơn (BATCH_OVERLAP)', async () => {
  const old = await svc.createShowtime({ movieId: movie.id, roomId: room.id, startTime: vn(D1, '09:00'), format: 'F2D', audio: 'SUBTITLE' });
  await svc.cancelShowtime({ showtimeId: old.id });
  const r = await svc.createShowtimesBulk(body({ dates: [D1], times: ['09:00', '10:00', '11:00'] }));
  assert.deepEqual(results(r), ['D1 09:00 OK', 'D1 10:00 BATCH_OVERLAP', 'D1 11:00 OK']);
  assert.equal(r.items[1].conflict.showtimeId, null);
});

test('giờ đã qua -> PAST, không tạo', async () => {
  const r = await svc.createShowtimesBulk(body({ dates: [dayKey(-1), D1], times: ['09:00'] }));
  assert.deepEqual(r.items.map((i) => i.result), ['PAST', 'OK']);
  assert.equal(await countInRoom(), 1);
});

test('phim ngừng chiếu / không tồn tại, phòng không tồn tại -> NOT_FOUND; quá 200 suất -> VALIDATION_ERROR', async () => {
  const ghost = '00000000-0000-4000-8000-000000000000';
  assert.equal(await failCode(svc.createShowtimesBulk(body({ movieId: ended.id }))), 'NOT_FOUND');
  assert.equal(await failCode(svc.createShowtimesBulk(body({ movieId: ghost }))), 'NOT_FOUND');
  assert.equal(await failCode(svc.createShowtimesBulk(body({ roomId: ghost }))), 'NOT_FOUND');
  const dates = Array.from({ length: 31 }, (_, i) => dayKey(100 + i));
  const times = Array.from({ length: 7 }, (_, i) => `${String(8 + i * 2).padStart(2, '0')}:00`);
  assert.equal(await failCode(svc.createShowtimesBulk(body({ dates, times }))), 'VALIDATION_ERROR');
  assert.equal(await countInRoom(), 0);
});

test('⭐ 6 admin tạo cùng một lô một lúc: mỗi khung giờ chỉ có ĐÚNG một suất', async () => {
  const all = await Promise.all(Array.from({ length: 6 }, () => svc.createShowtimesBulk(body())));
  assert.equal(all.reduce((sum, r) => sum + r.okCount, 0), 4);
  assert.equal(await countInRoom(), 4);
});

test('danh sách quản trị có bookedSeats: đơn đã trả và đơn giữ còn hạn được tính, đơn giữ hết hạn thì không', async () => {
  await svc.createShowtimesBulk(body({ dates: [D1], times: ['09:00', '14:00'] }));
  const [a, b] = await prisma.showtime.findMany({ where: { roomId: room.id }, orderBy: { startTime: 'asc' } });
  const order = (showtimeId, data) => createOrder({
    data: { code: `B${RUN}${Math.floor(Math.random() * 1e5)}`.slice(-10), userId: customer.id, showtimeId, expiresAt: new Date(Date.now() + 600_000), seatTotal: 0, total: 0, ...data },
  });
  await order(a.id, { status: 'PAID', paidAt: new Date() });
  await order(b.id, { status: 'PENDING', expiresAt: new Date(Date.now() - 60_000) });
  const list = await svc.listAdminShowtimes({ roomId: room.id, page: 1, pageSize: 10 });
  assert.deepEqual(list.items.map((s) => s.bookedSeats), [1, 0]);
});

test('HTTP: chỉ ADMIN; xem trước 200, tạo 201; ngày không tồn tại hoặc trường lạ -> 400', async () => {
  const send = (payload, role) => fetch(`${base}/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(role && { Authorization: `Bearer ${roles.token(role)}` }) },
    body: JSON.stringify(payload),
  });
  assert.equal((await send(body())).status, 401);
  assert.equal((await send(body(), 'USER')).status, 403);
  assert.equal((await send(body(), 'STAFF')).status, 403);
  assert.equal((await send(body({ dryRun: true }), 'ADMIN')).status, 200);
  const created = await send(body(), 'ADMIN');
  assert.equal(created.status, 201);
  assert.equal((await created.json()).data.okCount, 4);
  for (const bad of [{ dates: ['2027-02-30'] }, { dates: [] }, { times: ['25:00'] }, { status: 'OPEN' }]) {
    assert.equal((await send(body(bad), 'ADMIN')).status, 400, JSON.stringify(bad));
  }
});
