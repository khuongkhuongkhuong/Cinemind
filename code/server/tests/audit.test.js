// Nhật ký thao tác quản trị (FR-39): ghi đúng người / việc / đối tượng, không lộ bí mật, chỉ ghi thao tác thành công.
// Cần dữ liệu mẫu: chạy `npm run db:seed` trước.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { prisma } = await import('../src/config/prisma.js');
const { default: app } = await import('../src/app.js');
const { createRoleUsers } = await import('./helpers/role-users.js');

const minute = 60_000;
const RUN = Date.now();
const PASSWORD = `Pw-${RUN}-x`;
let roles; let server; let base; let city; let customer; let nearShowtime; let order;
const cinemaIds = []; const staffIds = [];

const call = (method, path, { role = 'ADMIN', body } = {}) => fetch(base + path, {
  method,
  headers: { ...(role && { Authorization: `Bearer ${roles.token(role)}` }), ...(body && { 'Content-Type': 'application/json' }) },
  body: body && JSON.stringify(body),
});
/** Nhật ký được ghi SAU khi trả phản hồi (best-effort) nên chờ tới khi thấy dòng mong muốn. */
async function waitForLog(where, timeoutMs = 3000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const rows = await prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' } });
    if (rows.length || Date.now() > end) return rows;
    await new Promise((r) => setTimeout(r, 50));
  }
}
const settle = () => new Promise((r) => setTimeout(r, 400)); // để chắc chắn KHÔNG có dòng nào được ghi muộn

before(async () => {
  roles = await createRoleUsers(prisma, `aud${RUN}`);
  city = await prisma.city.findFirst();
  customer = await prisma.user.create({ data: { email: `test-aud-${RUN}@example.com`, passwordHash: 'x', fullName: 'Test' } });
  const source = (await prisma.showtime.findMany({ where: { status: 'OPEN' }, take: 1 }))[0];
  nearShowtime = await prisma.showtime.create({
    data: {
      ...Object.fromEntries(['movieId', 'roomId', 'format', 'audio', 'basePrice'].map((k) => [k, source[k]])),
      startTime: new Date(Date.now() + 5 * minute), endTime: new Date(Date.now() + 120 * minute),
    },
  });
  order = await prisma.order.create({
    data: { code: `U${RUN}`.slice(-10).toUpperCase(), userId: customer.id, showtimeId: nearShowtime.id, status: 'PAID', paidAt: new Date(), expiresAt: new Date(Date.now() + 10 * minute), seatTotal: 0, total: 0 },
  });
  server = app.listen(0);
  base = `http://localhost:${server.address().port}/api/v1`;
});
after(async () => {
  server.close();
  await settle();
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: Object.values(roles.users).map((u) => u.id) } }, { actorId: null }] } });
  await prisma.order.deleteMany({ where: { userId: customer.id } });
  await prisma.showtime.delete({ where: { id: nearShowtime.id } });
  await prisma.cinema.deleteMany({ where: { id: { in: cinemaIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [customer.id, ...staffIds] } } });
  await roles.cleanup();
  await prisma.$disconnect();
});

test('phân quyền: xem nhật ký cần ADMIN (không token 401; USER / STAFF 403)', async () => {
  assert.equal((await call('GET', '/admin/audit-logs', { role: null })).status, 401);
  assert.equal((await call('GET', '/admin/audit-logs', { role: 'USER' })).status, 403);
  assert.equal((await call('GET', '/admin/audit-logs', { role: 'STAFF' })).status, 403);
  assert.equal((await call('GET', '/admin/audit-logs')).status, 200);
});

test('⭐ tạo rạp được ghi: đúng người thực hiện (từ token), mẫu route, id đối tượng vừa tạo, tên trường', async () => {
  const res = await call('POST', '/admin/cinemas', { body: { cityId: city.id, name: `TestCinema-${RUN}`, address: 'x' } });
  assert.equal(res.status, 201);
  const created = (await res.json()).data;
  cinemaIds.push(created.id);

  const [log] = await waitForLog({ entityId: created.id });
  assert.ok(log, 'phải có dòng nhật ký');
  assert.equal(log.actorId, roles.users.ADMIN.id);
  assert.equal(log.action, 'POST /admin/cinemas');
  assert.equal(log.entityType, 'cinemas');
  assert.deepEqual(log.details.fields.sort(), ['address', 'cityId', 'name']);
});

test('sửa có :id trên đường dẫn: mẫu route giữ nguyên ":id", entityId là id thật', async () => {
  const id = cinemaIds[0];
  await call('PUT', `/admin/cinemas/${id}`, { body: { name: `TestCinema-${RUN}-b` } });
  const rows = await waitForLog({ entityId: id, action: 'PUT /admin/cinemas/:id' });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].details.fields, ['name']);
});

test('⭐ đổi vai trò: ghi cả giá trị role (ai nâng ai lên mức nào) — nhưng KHÔNG ghi giá trị trường khác', async () => {
  await call('PATCH', `/admin/users/${customer.id}`, { body: { role: 'STAFF' } });
  const [log] = await waitForLog({ entityId: customer.id, action: 'PATCH /admin/users/:id' });
  assert.deepEqual(log.details, { fields: ['role'], values: { role: 'STAFF' } });
  await call('PATCH', `/admin/users/${customer.id}`, { body: { role: 'USER' } }); // trả lại
});

test('⭐ tạo nhân viên: ghi tên trường "password" nhưng TUYỆT ĐỐI không lưu giá trị mật khẩu', async () => {
  const email = `test-aud-staff-${RUN}@example.com`;
  const res = await call('POST', '/admin/users', { body: { email, password: PASSWORD, fullName: 'NV Test' } });
  assert.equal(res.status, 201);
  const created = (await res.json()).data;
  staffIds.push(created.id);
  const [log] = await waitForLog({ entityId: created.id });
  assert.ok(log.details.fields.includes('password'));
  const raw = JSON.stringify(await prisma.auditLog.findMany({ where: { entityId: created.id } }));
  assert.ok(!raw.includes(PASSWORD), 'mật khẩu không được xuất hiện trong nhật ký');
  assert.ok(!raw.includes(email), 'email cũng không cần lưu trong nhật ký');
});

test('⭐ chỉ ghi thao tác THÀNH CÔNG: yêu cầu sai (400), không tồn tại (404), bị từ chối (403) và GET đều không để lại dòng nào', async () => {
  // Chỉ đếm dòng của 3 tài khoản test này: các file test khác chạy song song cũng ghi nhật ký.
  const mine = { actorId: { in: Object.values(roles.users).map((u) => u.id) } };
  const before = await prisma.auditLog.count({ where: mine });
  await call('POST', '/admin/cinemas', { body: { cityId: city.id, name: '', address: 'x' } }); // 400
  await call('PUT', '/admin/cinemas/00000000-0000-4000-8000-000000000000', { body: { name: 'x' } }); // 404
  await call('POST', '/admin/cinemas', { role: 'USER', body: { cityId: city.id, name: 'x', address: 'x' } }); // 403
  await call('POST', '/admin/cinemas', { role: null, body: {} }); // 401
  await call('GET', '/admin/cinemas'); // GET
  await call('GET', '/admin/audit-logs'); // đọc nhật ký cũng không tự ghi nhật ký
  await settle();
  assert.equal(await prisma.auditLog.count({ where: mine }), before);
});

test('soát vé thành công (STAFF) được ghi với actor là nhân viên, entityType "tickets"', async () => {
  const res = await call('POST', `/staff/tickets/${order.code}/check-in`, { role: 'STAFF' });
  assert.equal(res.status, 200);
  const [log] = await waitForLog({ action: 'POST /staff/tickets/:code/check-in', entityId: order.code });
  assert.ok(log, 'phải có dòng nhật ký soát vé');
  assert.equal(log.actorId, roles.users.STAFF.id);
  assert.equal(log.entityType, 'tickets');
});

test('xem nhật ký: mới nhất trước, có người thực hiện, lọc theo actorId / entityType, phân trang; tham số sai -> 400', async () => {
  const all = (await (await call('GET', '/admin/audit-logs?pageSize=100')).json());
  const times = all.data.map((r) => Date.parse(r.createdAt));
  assert.deepEqual(times, [...times].sort((a, b) => b - a));
  const mine = (await (await call('GET', `/admin/audit-logs?actorId=${roles.users.ADMIN.id}&pageSize=100`)).json()).data;
  assert.ok(mine.length >= 3 && mine.every((r) => r.actor.id === roles.users.ADMIN.id));
  assert.ok(mine[0].actor.fullName && mine[0].actor.email);
  const cin = (await (await call('GET', '/admin/audit-logs?entityType=cinemas&pageSize=100')).json()).data;
  assert.ok(cin.length >= 2 && cin.every((r) => r.entityType === 'cinemas'));
  const page = await (await call('GET', '/admin/audit-logs?pageSize=1')).json();
  assert.equal(page.data.length, 1);
  assert.equal(page.meta.totalPages, page.meta.total);
  assert.equal((await call('GET', '/admin/audit-logs?actorId=abc')).status, 400);
});

test('AuditLog.actorId là SetNull: xóa tài khoản người thực hiện thì nhật ký vẫn còn (actor = null)', async () => {
  const u = await prisma.user.create({ data: { email: `test-aud-gone-${RUN}@example.com`, passwordHash: 'x', fullName: 'Gone', role: 'ADMIN' } });
  const log = await prisma.auditLog.create({ data: { actorId: u.id, action: 'DELETE /admin/x/:id', entityType: 'x' } });
  await prisma.user.delete({ where: { id: u.id } });
  const after = await prisma.auditLog.findUnique({ where: { id: log.id } });
  assert.ok(after);
  assert.equal(after.actorId, null);
});
