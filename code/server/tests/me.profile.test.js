// Hồ sơ cá nhân và đổi mật khẩu (FR-16).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test'; // tắt rate limit
const { prisma } = await import('../src/config/prisma.js');
const { default: app } = await import('../src/app.js');

const RUN = Date.now();
const email = `test-prof-${RUN}@example.com`;
const OLD = 'mat-khau-cu-12345';
const NEW = 'mat-khau-moi-67890';
let server; let base;

before(() => {
  server = app.listen(0);
  base = `http://localhost:${server.address().port}/api/v1`;
});
after(async () => {
  await prisma.user.deleteMany({ where: { email } }); // RefreshToken xóa theo (cascade)
  await prisma.$disconnect();
  server.close();
});

const call = async (path, { method = 'POST', body, token, cookie } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...(cookie && { Cookie: cookie }) },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('refreshToken='));
  return { status: res.status, json: text ? JSON.parse(text) : null, cookie: setCookie?.split(';')[0] };
};
const login = async (password) => call('/auth/login', { body: { email, password } });

let token; let phone1; let phone2; // phone1 / phone2: hai "thiết bị" (hai lần đăng nhập) của cùng một người

test('đăng ký rồi sửa hồ sơ: đổi họ tên và số điện thoại; không lộ passwordHash', async () => {
  const reg = await call('/auth/register', { body: { email, password: OLD, fullName: 'Tên Cũ' } });
  assert.equal(reg.status, 201);
  token = reg.json.data.accessToken;

  const r = await call('/me/profile', { method: 'PATCH', token, body: { fullName: '  Nguyễn Văn Mới  ', phone: '0912345678' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.data.fullName, 'Nguyễn Văn Mới'); // đã cắt khoảng trắng
  assert.equal(r.json.data.phone, '0912345678');
  assert.ok(!('passwordHash' in r.json.data));
  assert.equal((await call('/auth/me', { method: 'GET', token })).json.data.fullName, 'Nguyễn Văn Mới');

  const cleared = await call('/me/profile', { method: 'PATCH', token, body: { phone: null } }); // xóa số
  assert.equal(cleared.json.data.phone, null);
  assert.equal(cleared.json.data.fullName, 'Nguyễn Văn Mới'); // trường không gửi thì giữ nguyên
});

test('⭐ không tự nâng quyền: nhét role/email/points vào body bị TỪ CHỐI (400) và dữ liệu không đổi', async () => {
  for (const evil of [{ role: 'ADMIN' }, { email: 'khac@example.com' }, { points: 999999 }, { fullName: 'Ok', role: 'ADMIN' }]) {
    const r = await call('/me/profile', { method: 'PATCH', token, body: evil });
    assert.equal(r.status, 400, JSON.stringify(evil));
    assert.equal(r.json.error.code, 'VALIDATION_ERROR');
  }
  const row = await prisma.user.findUnique({ where: { email } });
  assert.equal(row.role, 'USER');
  assert.equal(row.points, 0);
});

test('hồ sơ: dữ liệu sai -> 400; body rỗng -> 400; không đăng nhập -> 401', async () => {
  assert.equal((await call('/me/profile', { method: 'PATCH', token, body: { phone: '12345' } })).status, 400);
  assert.equal((await call('/me/profile', { method: 'PATCH', token, body: { fullName: '   ' } })).status, 400);
  assert.equal((await call('/me/profile', { method: 'PATCH', token, body: {} })).status, 400);
  assert.equal((await call('/me/profile', { method: 'PATCH', body: { fullName: 'X' } })).status, 401);
});

test('đổi mật khẩu: sai mật khẩu hiện tại -> 400 (không phải 401), trùng mật khẩu cũ / quá ngắn -> 400', async () => {
  const wrong = await call('/me/password', { method: 'PUT', token, body: { currentPassword: 'sai-mat-khau', newPassword: NEW } });
  assert.equal(wrong.status, 400); // 401 sẽ làm client tưởng hết phiên và đăng xuất người dùng
  assert.ok(wrong.json.error.details.fields.currentPassword);
  const same = await call('/me/password', { method: 'PUT', token, body: { currentPassword: OLD, newPassword: OLD } });
  assert.ok(same.json.error.details.fields.newPassword);
  assert.equal((await call('/me/password', { method: 'PUT', token, body: { currentPassword: OLD, newPassword: 'ngan' } })).status, 400);
  assert.equal((await call('/me/password', { method: 'PUT', body: { currentPassword: OLD, newPassword: NEW } })).status, 401);
  assert.equal((await login(OLD)).status, 200); // chưa đổi gì
});

test('⭐ đổi mật khẩu thành công: 204, mật khẩu cũ hết dùng, mọi thiết bị khác bị đăng xuất, thiết bị hiện tại giữ phiên', async () => {
  phone1 = await login(OLD); // thiết bị 1 (đang thao tác)
  phone2 = await login(OLD); // thiết bị 2 (ví dụ máy bị mất)
  assert.notEqual(phone1.cookie, phone2.cookie);

  const change = await call('/me/password', { method: 'PUT', token: phone1.json.data.accessToken, body: { currentPassword: OLD, newPassword: NEW } });
  assert.equal(change.status, 204);
  assert.ok(change.cookie, 'phải cấp cookie refresh mới cho thiết bị hiện tại');

  assert.equal((await login(OLD)).status, 401); // mật khẩu cũ vô dụng
  assert.equal((await login(NEW)).status, 200);

  assert.equal((await call('/auth/refresh', { cookie: phone2.cookie })).status, 401); // thiết bị 2 bị đăng xuất
  assert.equal((await call('/auth/refresh', { cookie: phone1.cookie })).status, 401); // refresh token cũ của thiết bị 1 cũng hết
  const stay = await call('/auth/refresh', { cookie: change.cookie }); // nhưng cookie mới thì dùng được
  assert.equal(stay.status, 200);
  assert.ok(stay.json.data.accessToken);
});

test('mật khẩu mới được băm (không lưu thô)', async () => {
  const row = await prisma.user.findUnique({ where: { email } });
  assert.ok(row.passwordHash.startsWith('$2'));
  assert.ok(!row.passwordHash.includes(NEW));
});

test('tài khoản bị khóa: không sửa hồ sơ / đổi mật khẩu được (ACCOUNT_DISABLED)', async () => {
  const { accessToken } = (await login(NEW)).json.data;
  await prisma.user.update({ where: { email }, data: { isActive: false } });
  try {
    assert.equal((await call('/me/profile', { method: 'PATCH', token: accessToken, body: { fullName: 'X' } })).json.error.code, 'ACCOUNT_DISABLED');
    assert.equal((await call('/me/password', { method: 'PUT', token: accessToken, body: { currentPassword: NEW, newPassword: 'mat-khau-khac-1' } })).json.error.code, 'ACCOUNT_DISABLED');
  } finally {
    await prisma.user.update({ where: { email }, data: { isActive: true } });
  }
});
