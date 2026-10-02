// Danh sách rạp + phòng và sơ đồ ghế vật lý của một phòng (admin, chỉ đọc).
// Cần dữ liệu mẫu: chạy `npm run db:seed` trước.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { prisma } = await import('../src/config/prisma.js');
const { default: app } = await import('../src/app.js');
const { createRoleUsers } = await import('./helpers/role-users.js');

const RUN = Date.now();
let roles; let server; let base;
const get = (path, role = 'ADMIN') => fetch(base + path, role ? { headers: { Authorization: `Bearer ${roles.token(role)}` } } : {});

before(async () => {
  roles = await createRoleUsers(prisma, `cin${RUN}`);
  server = app.listen(0);
  base = `http://localhost:${server.address().port}/api/v1`;
});
after(async () => {
  server.close();
  await roles.cleanup();
  await prisma.$disconnect();
});

test('phân quyền: không token 401; USER / STAFF 403; ADMIN xem được', async () => {
  for (const path of ['/admin/cinemas', '/admin/rooms/00000000-0000-4000-8000-000000000000/seats']) {
    assert.equal((await get(path, null)).status, 401);
    assert.equal((await get(path, 'USER')).status, 403);
    assert.equal((await get(path, 'STAFF')).status, 403);
  }
  assert.equal((await get('/admin/cinemas')).status, 200);
});

test('danh sách rạp: có thành phố, các phòng và SỐ GHẾ mỗi phòng (dữ liệu mẫu: 4 rạp x 3 phòng x 96 ghế)', async () => {
  const cinemas = (await (await get('/admin/cinemas')).json()).data;
  const seeded = cinemas.filter((c) => c.name.startsWith('Cinemind'));
  assert.equal(seeded.length, 4);
  for (const c of seeded) {
    assert.ok(c.city.name && c.address);
    // Chỉ xét phòng của dữ liệu mẫu: test admin khác có thể tạm tạo phòng TestRoom-... trong cùng rạp khi chạy song song.
    const rooms = c.rooms.filter((r) => /^Phòng \d$/.test(r.name));
    assert.deepEqual(rooms.map((r) => r.name), ['Phòng 1', 'Phòng 2', 'Phòng 3']);
    assert.ok(rooms.every((r) => r.seatCount === 96 && r.isActive));
  }
  assert.ok(seeded.every((c) => !('createdAt' in c))); // chỉ trả các trường cần cho giao diện
});

test('sơ đồ ghế của phòng: đúng 96 ghế, hàng A–H, ghế đôi có pairCode, không có trạng thái đặt chỗ', async () => {
  const room = await prisma.room.findFirst({ where: { name: 'Phòng 1' } });
  const res = await get(`/admin/rooms/${room.id}/seats`);
  assert.equal(res.status, 200);
  const data = (await res.json()).data;
  assert.equal(data.room.id, room.id);
  assert.ok(data.room.cinema.name);
  assert.deepEqual(data.rows, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  assert.equal(data.seats.length, 96);
  const h1 = data.seats.find((s) => s.label === 'H1');
  assert.deepEqual([h1.type, h1.pairCode, h1.isActive], ['COUPLE', 'H1-2', true]);
  assert.ok(data.seats.every((s) => !('status' in s) && !('price' in s))); // sơ đồ vật lý: trạng thái / giá thuộc về từng suất
});

test('phòng không tồn tại -> 404 NOT_FOUND; id sai định dạng -> 400', async () => {
  const missing = await get('/admin/rooms/00000000-0000-4000-8000-000000000000/seats');
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, 'NOT_FOUND');
  assert.equal((await get('/admin/rooms/abc/seats')).status, 400);
});
