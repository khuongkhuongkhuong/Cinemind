// Quản lý tài khoản (admin) và hiệu lực NGAY của khóa / hạ quyền trên route đặc quyền.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test'; // tắt rate limit
const { prisma } = await import('../src/config/prisma.js');
const svc = await import('../src/services/adminUser.service.js');
const { default: app } = await import('../src/app.js');
const { signAccessToken } = await import('../src/lib/jwt.js');
const { createRoleUsers } = await import('./helpers/role-users.js');

const RUN = Date.now();
const PASSWORD = 'mat-khau-nhan-vien-1';
let roles; let server; let base;
const extraIds = [];

const failErr = (p) => p.then(() => null, (e) => e);
const makeUser = async (role = 'USER', tag = '') => {
  const u = await prisma.user.create({ data: { email: `test-aus-${RUN}-${extraIds.length}${tag}@example.com`, passwordHash: 'x', fullName: `Người Dùng ${RUN}`, role } });
  extraIds.push(u.id);
  return u;
};
const as = (role) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${roles.token(role)}` });
const http = (method, path, { role = 'ADMIN', token, body } = {}) => fetch(base + path, {
  method, headers: token ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } : as(role), body: body && JSON.stringify(body),
});

before(async () => {
  roles = await createRoleUsers(prisma, `usr${RUN}`);
  server = app.listen(0);
  base = `http://localhost:${server.address().port}/api/v1`;
});

after(async () => {
  server.close();
  await prisma.user.deleteMany({ where: { OR: [{ id: { in: extraIds } }, { email: { startsWith: `test-aus-${RUN}` } }] } });
  await roles.cleanup();
  await prisma.$disconnect();
});

test('tạo nhân viên: vai trò STAFF, đăng nhập được bằng mật khẩu đã đặt, mật khẩu được băm, không lộ passwordHash', async () => {
  const email = `test-aus-${RUN}-staff@example.com`;
  const r = await http('POST', '/admin/users', { body: { email: email.toUpperCase(), password: PASSWORD, fullName: 'Nhân Viên Mới', phone: '0912345678' } });
  assert.equal(r.status, 201);
  const u = (await r.json()).data;
  extraIds.push(u.id);
  assert.equal(u.role, 'STAFF');
  assert.equal(u.email, email); // đã chuẩn hóa chữ thường
  assert.ok(!('passwordHash' in u));
  assert.ok((await prisma.user.findUnique({ where: { id: u.id } })).passwordHash.startsWith('$2'));

  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).data.user.role, 'STAFF');

  const dup = await http('POST', '/admin/users', { body: { email, password: PASSWORD, fullName: 'Trùng' } });
  assert.equal(dup.status, 409);
  assert.equal((await dup.json()).error.code, 'EMAIL_EXISTS');
});

test('⭐ tạo tài khoản không nhận `role`: không thể tạo ADMIN qua API này (400)', async () => {
  const r = await http('POST', '/admin/users', { body: { email: `test-aus-${RUN}-evil@example.com`, password: PASSWORD, fullName: 'X', role: 'ADMIN' } });
  assert.equal(r.status, 400);
  assert.equal(await prisma.user.count({ where: { email: `test-aus-${RUN}-evil@example.com` } }), 0);
  assert.equal((await http('POST', '/admin/users', { body: { email: 'khong-phai-email', password: '123', fullName: '' } })).status, 400);
});

test('danh sách: lọc vai trò, tìm email/họ tên không phân biệt hoa-thường, phân trang, không lộ passwordHash', async () => {
  const s = await makeUser('STAFF');
  await makeUser('USER');
  const all = await svc.listUsers({ q: `NGƯỜI DÙNG ${RUN}`, page: 1, pageSize: 50 });
  assert.equal(all.meta.total, 2);
  assert.ok(all.items.every((u) => !('passwordHash' in u)));
  const staffOnly = await svc.listUsers({ q: String(RUN), role: 'STAFF', page: 1, pageSize: 50 });
  assert.ok(staffOnly.items.some((u) => u.id === s.id));
  assert.ok(staffOnly.items.every((u) => u.role === 'STAFF'));
  const page = await svc.listUsers({ q: `NGƯỜI DÙNG ${RUN}`, page: 2, pageSize: 1 });
  assert.equal(page.items.length, 1);
  assert.equal(page.meta.totalPages, 2);
});

test('đổi vai trò; khóa tài khoản: không đăng nhập được, refresh token bị thu hồi; mở khóa thì dùng lại được', async () => {
  const email = `test-aus-${RUN}-lock@example.com`;
  const reg = await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD, fullName: `Người Dùng ${RUN}` }) });
  const user = (await reg.json()).data.user;
  extraIds.push(user.id);
  const cookie = reg.headers.getSetCookie().find((c) => c.startsWith('refreshToken=')).split(';')[0];

  assert.equal((await svc.updateUser({ actorId: roles.users.ADMIN.id, userId: user.id, role: 'STAFF' })).role, 'STAFF');

  const locked = await svc.updateUser({ actorId: roles.users.ADMIN.id, userId: user.id, isActive: false });
  assert.equal(locked.isActive, false);
  const login = (password) => fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.equal((await (await login(PASSWORD)).json()).error.code, 'ACCOUNT_DISABLED');
  const refresh = await fetch(`${base}/auth/refresh`, { method: 'POST', headers: { Cookie: cookie } });
  assert.equal(refresh.status, 401); // refresh token đã bị thu hồi khi khóa

  await svc.updateUser({ actorId: roles.users.ADMIN.id, userId: user.id, isActive: true });
  assert.equal((await login(PASSWORD)).status, 200);
});

test('⭐ admin không tự khóa / tự hạ quyền chính mình (FORBIDDEN); gửi lại đúng vai trò hiện tại thì không sao', async () => {
  const me = roles.users.ADMIN;
  const lock = await failErr(svc.updateUser({ actorId: me.id, userId: me.id, isActive: false }));
  assert.equal(lock.code, 'FORBIDDEN');
  assert.equal((await failErr(svc.updateUser({ actorId: me.id, userId: me.id, role: 'USER' }))).code, 'FORBIDDEN');
  assert.equal((await svc.updateUser({ actorId: me.id, userId: me.id, role: 'ADMIN' })).role, 'ADMIN'); // không thay đổi gì
  const row = await prisma.user.findUnique({ where: { id: me.id } });
  assert.deepEqual([row.role, row.isActive], ['ADMIN', true]);

  const viaHttp = await http('PATCH', `/admin/users/${me.id}`, { body: { isActive: false } });
  assert.equal(viaHttp.status, 403);
});

test('⭐ luôn còn ít nhất một admin hoạt động: không khóa / hạ quyền người admin cuối cùng (kiểm trong transaction rồi rollback)', async () => {
  const A = await makeUser('ADMIN');
  const B = await makeUser('USER');
  const actor = roles.users.ADMIN;
  const ROLLBACK = new Error('rollback');
  await prisma.$transaction(async (tx) => {
    // Giả lập tình huống chỉ còn A là admin đang hoạt động (mọi admin khác tạm khóa) — sẽ ROLLBACK, không ảnh hưởng ai.
    await tx.user.updateMany({ where: { role: 'ADMIN', isActive: true, id: { not: A.id } }, data: { isActive: false } });

    const lock = await failErr(svc.applyUserUpdate(tx, { actorId: actor.id, userId: A.id, isActive: false }));
    assert.equal(lock.code, 'FORBIDDEN');
    assert.match(lock.message, /ít nhất một quản trị viên/);
    assert.equal((await failErr(svc.applyUserUpdate(tx, { actorId: actor.id, userId: A.id, role: 'STAFF' }))).code, 'FORBIDDEN');

    await svc.applyUserUpdate(tx, { actorId: actor.id, userId: B.id, role: 'ADMIN' }); // có người thay thế thì hạ quyền A được
    assert.equal((await svc.applyUserUpdate(tx, { actorId: actor.id, userId: A.id, role: 'USER' })).role, 'USER');
    throw ROLLBACK;
  }).catch((e) => { if (e !== ROLLBACK) throw e; });
  assert.equal((await prisma.user.findUnique({ where: { id: A.id } })).role, 'ADMIN'); // rollback thật
});

test('⭐ hạ quyền / khóa có hiệu lực NGAY trên /admin và /staff dù access token còn hạn', async () => {
  // Admin phụ với token còn nguyên hạn.
  const second = await makeUser('ADMIN');
  const token = signAccessToken({ id: second.id, role: 'ADMIN' });
  assert.equal((await http('GET', '/admin/users?pageSize=1', { token })).status, 200);
  await svc.updateUser({ actorId: roles.users.ADMIN.id, userId: second.id, role: 'USER' });
  const after403 = await http('GET', '/admin/users?pageSize=1', { token }); // CÙNG token, ngay lập tức
  assert.equal(after403.status, 403);
  assert.equal((await after403.json()).error.code, 'FORBIDDEN');

  // Nhân viên bị khóa: soát vé bị chặn ngay.
  const staff = await makeUser('STAFF');
  const staffToken = signAccessToken({ id: staff.id, role: 'STAFF' });
  assert.equal((await http('GET', '/staff/tickets/KHONGCO1', { token: staffToken })).status, 404); // dùng được (vé không tồn tại)
  await svc.updateUser({ actorId: roles.users.ADMIN.id, userId: staff.id, isActive: false });
  const blocked = await http('GET', '/staff/tickets/KHONGCO1', { token: staffToken });
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).error.code, 'ACCOUNT_DISABLED');

  // Tài khoản không còn tồn tại.
  assert.equal((await http('GET', '/admin/users', { token: signAccessToken({ id: '00000000-0000-4000-8000-000000000000', role: 'ADMIN' }) })).status, 401);
});

test('route khách hàng thường chỉ chậm tối đa 15 phút (đánh đổi có chủ đích: không hỏi DB mỗi request): token cũ của tài khoản bị khóa vẫn xem được vé của mình', async () => {
  const u = await makeUser('USER');
  const token = signAccessToken({ id: u.id, role: 'USER' });
  await svc.updateUser({ actorId: roles.users.ADMIN.id, userId: u.id, isActive: false });
  assert.equal((await http('GET', '/me/orders', { token })).status, 200); // còn hạn token; /auth/me và refresh thì đã chặn
  assert.equal((await http('GET', '/auth/me', { token })).status, 403);
});

test('HTTP: không token 401; USER / STAFF 403; trường lạ và vai trò sai 400; id lạ 404', async () => {
  assert.equal((await fetch(`${base}/admin/users`)).status, 401);
  assert.equal((await http('GET', '/admin/users', { role: 'USER' })).status, 403);
  assert.equal((await http('GET', '/admin/users', { role: 'STAFF' })).status, 403);
  const u = await makeUser('USER');
  assert.equal((await http('PATCH', `/admin/users/${u.id}`, { body: { role: 'SUPERUSER' } })).status, 400);
  assert.equal((await http('PATCH', `/admin/users/${u.id}`, { body: { points: 9999 } })).status, 400);
  assert.equal((await http('PATCH', `/admin/users/${u.id}`, { body: {} })).status, 400);
  assert.equal((await http('PATCH', '/admin/users/00000000-0000-4000-8000-000000000000', { body: { isActive: false } })).status, 404);
  const ok = await http('PATCH', `/admin/users/${u.id}`, { body: { role: 'STAFF' } });
  assert.equal((await ok.json()).data.role, 'STAFF');
});
