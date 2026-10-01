import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test'; // tắt rate limit; phải đặt TRƯỚC khi import app
const { default: app } = await import('../src/app.js');
const { prisma } = await import('../src/config/prisma.js');
const { signAccessToken } = await import('../src/lib/jwt.js');

const email = `test-${Date.now()}@example.com`;
const password = 'matkhau-test-123';
let server;
let base;

before(async () => {
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
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(cookie && { Cookie: cookie }),
    },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('refreshToken='));
  return { status: res.status, json: text ? JSON.parse(text) : null, setCookie };
};
const cookieValue = (setCookie) => setCookie.split(';')[0]; // "refreshToken=abc"

let accessToken;
let refreshCookie;

test('đăng ký thành công: 201, có accessToken, cookie httpOnly, không lộ passwordHash', async () => {
  const r = await call('/auth/register', { body: { email, password, fullName: 'Người Test' } });
  assert.equal(r.status, 201);
  assert.equal(r.json.data.user.email, email);
  assert.equal(r.json.data.user.role, 'USER');
  assert.ok(!('passwordHash' in r.json.data.user));
  assert.ok(!('refreshToken' in r.json.data));
  assert.match(r.setCookie, /HttpOnly/i);
  assert.match(r.setCookie, /Path=\/api\/v1\/auth/);
});

test('đăng ký trùng email -> 409 EMAIL_EXISTS', async () => {
  const r = await call('/auth/register', { body: { email, password, fullName: 'Người Test' } });
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, 'EMAIL_EXISTS');
});

test('dữ liệu sai -> 400 VALIDATION_ERROR có details.fields', async () => {
  const r = await call('/auth/register', { body: { email: 'khong-phai-email', password: '123', fullName: '' } });
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, 'VALIDATION_ERROR');
  assert.ok(r.json.error.details.fields.email);
  assert.ok(r.json.error.details.fields.password);
});

test('sai mật khẩu và sai email cùng trả INVALID_CREDENTIALS', async () => {
  const a = await call('/auth/login', { body: { email, password: 'sai-mat-khau' } });
  const b = await call('/auth/login', { body: { email: 'khong-ton-tai@example.com', password } });
  assert.equal(a.status, 401);
  assert.equal(a.json.error.code, 'INVALID_CREDENTIALS');
  assert.deepEqual(a.json.error.code, b.json.error.code);
});

test('đăng nhập đúng -> /auth/me trả đúng người', async () => {
  const login = await call('/auth/login', { body: { email: email.toUpperCase(), password } }); // email không phân biệt hoa/thường
  assert.equal(login.status, 200);
  accessToken = login.json.data.accessToken;
  refreshCookie = cookieValue(login.setCookie);
  const me = await call('/auth/me', { method: 'GET', token: accessToken });
  assert.equal(me.json.data.email, email);
});

test('không có token / token rác -> 401 UNAUTHORIZED', async () => {
  assert.equal((await call('/auth/me', { method: 'GET' })).json.error.code, 'UNAUTHORIZED');
  assert.equal((await call('/auth/me', { method: 'GET', token: 'rac' })).json.error.code, 'UNAUTHORIZED');
});

test('token hết hạn -> 401 TOKEN_EXPIRED', async () => {
  const jwt = (await import('jsonwebtoken')).default;
  const { env } = await import('../src/config/env.js');
  const expired = jwt.sign({ role: 'USER' }, env.JWT_ACCESS_SECRET, { subject: 'x', expiresIn: -10 });
  const r = await call('/auth/me', { method: 'GET', token: expired });
  assert.equal(r.json.error.code, 'TOKEN_EXPIRED');
});

test('refresh: đổi được access token mới, và refresh token cũ KHÔNG dùng lại được (rotation)', async () => {
  const first = await call('/auth/refresh', { cookie: refreshCookie });
  assert.equal(first.status, 200);
  assert.ok(first.json.data.accessToken);
  const newCookie = cookieValue(first.setCookie);
  assert.notEqual(newCookie, refreshCookie);

  const replay = await call('/auth/refresh', { cookie: refreshCookie }); // dùng lại token cũ
  assert.equal(replay.status, 401);
  assert.equal(replay.json.error.code, 'UNAUTHORIZED');
  refreshCookie = newCookie;
});

test('refresh đồng thời với cùng một token: chỉ đúng 1 request thành công', async () => {
  const login = await call('/auth/login', { body: { email, password } });
  const cookie = cookieValue(login.setCookie);
  const results = await Promise.all(Array.from({ length: 10 }, () => call('/auth/refresh', { cookie })));
  assert.equal(results.filter((r) => r.status === 200).length, 1);
});

test('phân quyền: USER vào route ADMIN -> 403 FORBIDDEN', async () => {
  const { requireAuth, requireRole } = await import('../src/middlewares/auth.js');
  const run = (role, mw) => {
    const req = { headers: { authorization: `Bearer ${signAccessToken({ id: 'u1', role })}` } };
    try { requireAuth(req, {}, () => {}); mw(req, {}, () => {}); return 'ok'; } catch (e) { return e.code; }
  };
  assert.equal(run('USER', requireRole('ADMIN')), 'FORBIDDEN');
  assert.equal(run('ADMIN', requireRole('ADMIN')), 'ok');
  assert.equal(run('ADMIN', requireRole('STAFF', 'ADMIN')), 'ok');
});

test('logout: thu hồi refresh token, sau đó refresh -> 401', async () => {
  const out = await call('/auth/logout', { token: accessToken, cookie: refreshCookie });
  assert.equal(out.status, 204);
  const r = await call('/auth/refresh', { cookie: refreshCookie });
  assert.equal(r.status, 401);
});
