// Quản trị suất chiếu: chặn trùng giờ (SHOWTIME_OVERLAP), sửa/hủy suất đã bán (RESOURCE_IN_USE), phân quyền ADMIN.
// Cần dữ liệu mẫu: chạy `npm run db:seed` trước.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { prisma } = await import('../src/config/prisma.js');
const svc = await import('../src/services/showtime.service.js');
const { getBasePrice } = await import('../src/services/pricing.service.js');
const { default: app } = await import('../src/app.js');
const { signAccessToken } = await import('../src/lib/jwt.js');
const { createRoleUsers } = await import('./helpers/role-users.js');

const minute = 60_000;
const DAY = 24 * 60 * minute;
const RUN = Date.now();
let movie; let room; let otherRoom; let customer; let roles;
let T0; // gốc thời gian: 60 ngày nữa, làm tròn giờ — xa hơn dữ liệu seed (7 ngày) nên không đụng ai
const createdIds = new Set();

const at = (day, offsetMin = 0) => new Date(T0.getTime() + day * DAY + offsetMin * minute);
const base = (day, offsetMin, extra = {}) => ({ movieId: movie.id, roomId: room.id, startTime: at(day, offsetMin), format: 'F2D', audio: 'SUBTITLE', ...extra });
const failErr = (p) => p.then(() => null, (e) => e);
const create = async (data) => { const s = await svc.createShowtime(data); createdIds.add(s.id); return s; };
const makeOrder = (showtimeId, data) => prisma.order.create({
  data: { code: `A${RUN}${createdIds.size}${Math.floor(Math.random() * 1e4)}`.slice(-10), userId: customer.id, showtimeId, expiresAt: new Date(Date.now() + 10 * minute), seatTotal: 0, total: 0, ...data },
});

before(async () => {
  T0 = new Date(Math.ceil((Date.now() + 60 * DAY) / (60 * minute)) * 60 * minute);
  movie = await prisma.movie.findUnique({ where: { slug: 'nha-ba-tu' } }); // 102 phút
  // Phòng RIÊNG của test: không đụng suất chiếu seed, và nếu test bị ngắt giữa chừng thì không để lại xung đột.
  const cinema = await prisma.cinema.findFirst();
  room = await prisma.room.create({ data: { cinemaId: cinema.id, name: `TestRoom-${RUN}-A` } });
  otherRoom = await prisma.room.create({ data: { cinemaId: cinema.id, name: `TestRoom-${RUN}-B` } });
  customer = await prisma.user.create({ data: { email: `test-ashow-${RUN}@example.com`, passwordHash: 'x', fullName: 'Test' } });
  roles = await createRoleUsers(prisma, `sho${RUN}`);
});

after(async () => {
  const ids = [...createdIds];
  await prisma.order.deleteMany({ where: { showtimeId: { in: ids } } });
  await prisma.showtime.deleteMany({ where: { OR: [{ id: { in: ids } }, { roomId: { in: [room.id, otherRoom.id] } }] } });
  await prisma.room.deleteMany({ where: { id: { in: [room.id, otherRoom.id] } } });
  await prisma.user.delete({ where: { id: customer.id } });
  await roles.cleanup();
  await prisma.$disconnect();
});

test('tạo suất: server tự tính endTime (thời lượng + 15 phút dọn) và giá từ bảng giá; giá gửi lên được ưu tiên', async () => {
  const s = await create(base(0, 0));
  assert.equal(new Date(s.endTime).getTime() - new Date(s.startTime).getTime(), (movie.durationMin + 15) * minute);
  assert.equal(s.basePrice, (await getBasePrice({ format: 'F2D', startTime: at(0) })).basePrice);
  assert.equal(s.status, 'OPEN');
  assert.equal(s.movie.title, movie.title);
  const custom = await create(base(0, 600, { basePrice: 12_345, format: 'IMAX' }));
  assert.equal(custom.basePrice, 12_345);
});

test('tạo suất: giờ quá khứ -> VALIDATION_ERROR; phim/phòng không tồn tại -> NOT_FOUND', async () => {
  const past = await failErr(svc.createShowtime(base(0, 0, { startTime: new Date(Date.now() - minute) })));
  assert.equal(past.code, 'VALIDATION_ERROR');
  const ghost = '00000000-0000-4000-8000-000000000000';
  assert.equal((await failErr(svc.createShowtime(base(1, 0, { movieId: ghost })))).code, 'NOT_FOUND');
  assert.equal((await failErr(svc.createShowtime(base(1, 0, { roomId: ghost })))).code, 'NOT_FOUND');
});

test('⭐ chặn trùng giờ: chồng lấn -> SHOWTIME_OVERLAP kèm conflictShowtimeId; nối đuôi, phòng khác, suất đã hủy thì được', async () => {
  const a = await create(base(2, 0)); // chiếm [0, 117) phút
  const overlap = async (offset, extra) => failErr(svc.createShowtime(base(2, offset, extra)));

  const e1 = await overlap(60); // bắt đầu giữa suất A
  assert.equal(e1.code, 'SHOWTIME_OVERLAP');
  assert.equal(e1.details.conflictShowtimeId, a.id);
  assert.equal((await overlap(-100)).code, 'SHOWTIME_OVERLAP'); // kết thúc (phút 17) rơi vào suất A
  assert.equal((await overlap(0)).code, 'SHOWTIME_OVERLAP'); // trùng hẳn

  const back = await create(base(2, 117)); // bắt đầu ĐÚNG lúc A kết thúc: không trùng
  assert.equal(new Date(back.startTime).getTime(), new Date(a.endTime).getTime());
  await create(base(2, 60, { roomId: otherRoom.id })); // phòng khác: không liên quan

  await svc.cancelShowtime({ showtimeId: a.id });
  await create(base(2, 0)); // A đã hủy -> slot của A được dùng lại (suất nối đuôi vẫn ở phút 117, không đụng)
});

test('⭐ 10 admin tạo suất chồng lấn cùng phòng cùng lúc: đúng 1 thành công (khóa theo phòng chống race)', async () => {
  const results = await Promise.all(
    Array.from({ length: 10 }, () => svc.createShowtime(base(3, 0)).then((s) => { createdIds.add(s.id); return 'ok'; }, (e) => e.code)),
  );
  assert.equal(results.filter((r) => r === 'ok').length, 1);
  assert.equal(results.filter((r) => r === 'SHOWTIME_OVERLAP').length, 9);
  const rows = await prisma.showtime.count({ where: { roomId: room.id, startTime: at(3, 0) } });
  assert.equal(rows, 1);
});

test('sửa suất: đổi giờ tính lại endTime và giá; tự dời trong chính mình không bị coi là trùng; dời đè suất khác -> OVERLAP', async () => {
  const a = await create(base(4, 0)); // [0,117)
  const b = await create(base(4, 300)); // [300,417)

  const moved = await svc.updateShowtime({ showtimeId: a.id, startTime: at(4, 30) }); // chồng lên chính vị trí cũ của nó: hợp lệ
  assert.equal(new Date(moved.startTime).getTime(), at(4, 30).getTime());
  assert.equal(new Date(moved.endTime).getTime(), at(4, 30 + 117).getTime());

  const clash = await failErr(svc.updateShowtime({ showtimeId: a.id, startTime: at(4, 280) }));
  assert.equal(clash.code, 'SHOWTIME_OVERLAP');
  assert.equal(clash.details.conflictShowtimeId, b.id);

  const imax = await svc.updateShowtime({ showtimeId: a.id, format: 'IMAX' });
  assert.equal(imax.basePrice, (await getBasePrice({ format: 'IMAX', startTime: at(4, 30) })).basePrice);
  assert.equal((await svc.updateShowtime({ showtimeId: a.id, basePrice: 99_000 })).basePrice, 99_000);
});

test('⭐ suất đã có người mua/giữ: không sửa, không hủy được (RESOURCE_IN_USE); đơn PENDING đã hết hạn thì không chặn', async () => {
  const paid = await create(base(5, 0));
  await makeOrder(paid.id, { status: 'PAID', paidAt: new Date() });
  assert.equal((await failErr(svc.updateShowtime({ showtimeId: paid.id, audio: 'DUBBED' }))).code, 'RESOURCE_IN_USE');
  assert.equal((await failErr(svc.cancelShowtime({ showtimeId: paid.id }))).code, 'RESOURCE_IN_USE');

  const held = await create(base(5, 300));
  await makeOrder(held.id, { status: 'PENDING' }); // đang giữ ghế, còn hạn
  assert.equal((await failErr(svc.cancelShowtime({ showtimeId: held.id }))).code, 'RESOURCE_IN_USE');

  const stale = await create(base(5, 600));
  await makeOrder(stale.id, { status: 'PENDING', expiresAt: new Date(Date.now() - minute) });
  assert.equal((await svc.cancelShowtime({ showtimeId: stale.id })).status, 'CANCELLED');
});

test('hủy suất: chuyển CANCELLED (không xóa), gọi lại không lỗi, suất đã hủy không sửa được và không còn mở bán', async () => {
  const s = await create(base(6, 0));
  assert.equal((await svc.cancelShowtime({ showtimeId: s.id })).status, 'CANCELLED');
  assert.equal((await svc.cancelShowtime({ showtimeId: s.id })).status, 'CANCELLED'); // idempotent
  assert.equal((await failErr(svc.updateShowtime({ showtimeId: s.id, audio: 'DUBBED' }))).code, 'RESOURCE_IN_USE');
  assert.equal((await svc.getShowtime({ showtimeId: s.id })).isOpenForSale, false);
  assert.equal((await failErr(svc.cancelShowtime({ showtimeId: '00000000-0000-4000-8000-000000000000' }))).code, 'NOT_FOUND');
});

test('danh sách admin: lọc theo phòng + ngày (giờ VN), có phân trang', async () => {
  await create(base(7, 0)); await create(base(7, 200));
  const vnDate = new Date(at(7, 0).getTime() + 7 * 60 * minute).toISOString().slice(0, 10);
  const r = await svc.listAdminShowtimes({ roomId: room.id, date: vnDate, page: 1, pageSize: 1 });
  assert.ok(r.meta.total >= 2);
  assert.equal(r.items.length, 1);
  assert.equal(r.meta.totalPages, r.meta.total);
  assert.ok(r.items[0].cinema.name && r.items[0].room.name && r.items[0].movie.title);
});

test('HTTP: không token 401, USER và STAFF 403 (chỉ ADMIN), ADMIN tạo 201 và gặp 409 khi trùng; body sai 400', async () => {
  const server = app.listen(0);
  const url = `http://localhost:${server.address().port}/api/v1/admin/showtimes`;
  const hdr = (role) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${roles.token(role)}` });
  const body = { movieId: movie.id, roomId: room.id, startTime: at(8, 0).toISOString(), format: 'F3D', audio: 'DUBBED' };
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: hdr('USER') })).status, 403);
    assert.equal((await fetch(url, { method: 'POST', headers: hdr('STAFF'), body: JSON.stringify(body) })).status, 403);

    const res = await fetch(url, { method: 'POST', headers: hdr('ADMIN'), body: JSON.stringify(body) });
    assert.equal(res.status, 201);
    const made = (await res.json()).data;
    createdIds.add(made.id);
    assert.equal(made.format, 'F3D');

    const dup = await fetch(url, { method: 'POST', headers: hdr('ADMIN'), body: JSON.stringify(body) });
    assert.equal(dup.status, 409);
    const err = (await dup.json()).error;
    assert.equal(err.code, 'SHOWTIME_OVERLAP');
    assert.equal(err.details.conflictShowtimeId, made.id);

    assert.equal((await fetch(url, { method: 'POST', headers: hdr('ADMIN'), body: JSON.stringify({ ...body, format: 'F9' }) })).status, 400);
    assert.equal((await fetch(`${url}/${made.id}`, { method: 'PUT', headers: hdr('ADMIN'), body: '{}' })).status, 400);
    const cancel = await fetch(`${url}/${made.id}/cancel`, { method: 'PATCH', headers: hdr('ADMIN') });
    assert.equal((await cancel.json()).data.status, 'CANCELLED');
    const list = await (await fetch(`${url}?roomId=${room.id}&pageSize=100`, { headers: hdr('ADMIN') })).json();
    assert.ok(list.meta.total >= 1);
  } finally {
    server.close();
  }
});
