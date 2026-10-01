// Kiểm thử bảo mật: header, đầu vào độc hại, JWT, cổng giả lập, cấu hình production, rate limit.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
const { default: app } = await import('../src/app.js');
const { prisma } = await import('../src/config/prisma.js');
const { env, parseEnv } = await import('../src/config/env.js');
const { rateLimit } = await import('../src/middlewares/rateLimit.js');
const { createRoleUsers } = await import('./helpers/role-users.js');

const RUN = Date.now();
let server; let base; let roles;
before(async () => {
  roles = await createRoleUsers(prisma, `sec${RUN}`);
  server = app.listen(0);
  base = `http://localhost:${server.address().port}/api/v1`;
});
after(async () => {
  server.close();
  await roles.cleanup();
  await prisma.$disconnect();
});

const get = (path, headers = {}) => fetch(base + path, { headers });
const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });

// ------------------------------------------------------------------ HEADER
test('⭐ header bảo mật: nosniff, chống nhúng iframe, CSP chặn mọi thứ, không rò referrer; không lộ "X-Powered-By: Express"', async () => {
  const h = (await get('/health')).headers;
  assert.equal(h.get('x-powered-by'), null);
  assert.equal(h.get('x-content-type-options'), 'nosniff');
  assert.equal(h.get('x-frame-options'), 'DENY');
  assert.equal(h.get('referrer-policy'), 'no-referrer');
  assert.match(h.get('content-security-policy'), /default-src 'none'.*frame-ancestors 'none'/);
  assert.equal(h.get('strict-transport-security'), null); // chỉ production
});

test('Cache-Control: no-store cho route chứa token / dữ liệu cá nhân (kể cả lỗi), không ép cho danh mục công khai', async () => {
  for (const path of ['/auth/me', '/me/orders', '/orders/abc', '/payments/x/status', '/staff/tickets/x', '/admin/users']) {
    assert.equal((await get(path)).headers.get('cache-control'), 'no-store', path);
  }
  const login = await post('/auth/login', JSON.stringify({ email: 'khong-co@example.com', password: 'x' }));
  assert.equal(login.headers.get('cache-control'), 'no-store');
  assert.equal((await get('/movies')).headers.get('cache-control'), null);
});

// -------------------------------------------------------------- ĐẦU VÀO ĐỘC HẠI
test('⭐ ký tự NUL (%00 / \\u0000) bị từ chối 400 thay vì làm DB lỗi 500', async () => {
  for (const path of ['/movies/%00', '/movies?q=%00', '/movies/nha%00ba', '/showtimes/%00/seats']) {
    const r = await get(path);
    assert.equal(r.status, 400, path);
    assert.equal((await r.json()).error.code, 'VALIDATION_ERROR');
  }
  const body = await post('/auth/login', JSON.stringify({ email: 'a@b.co', password: 'abc\u0000def' }));
  assert.equal(body.status, 400);
  assert.equal((await post('/auth/register', JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(8), fullName: 'ten\u0000x' }))).status, 400);
  assert.equal((await get('/health')).status, 200); // server vẫn sống
});

test('chuỗi %xx hỏng trong URL -> 400 (không phải 500)', async () => {
  for (const path of ['/movies/%E0%A4%A', '/movies/%']) {
    const r = await get(path);
    assert.equal(r.status, 400, path);
  }
});

test('⭐ body quá lớn (> 100 KB) -> 413, không phải 500; body vừa phải vẫn xử lý bình thường', async () => {
  const big = await post('/auth/login', JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(300_000) }));
  assert.equal(big.status, 413);
  const json = await big.json();
  assert.equal(json.error.code, 'VALIDATION_ERROR');
  assert.match(json.error.message, /quá lớn/);
  const ok = await post('/auth/login', JSON.stringify({ email: 'khong-co@example.com', password: 'x'.repeat(5_000) }));
  assert.equal(ok.status, 401); // 5 KB hợp lệ về kích thước, chỉ sai thông tin đăng nhập
});

test('SQL injection / đường dẫn lạ không gây lỗi hay rò rỉ: kết quả bình thường hoặc 400, không bao giờ 500', async () => {
  for (const path of ["/movies?q=%27%20OR%201%3D1%20--", '/movies?q=%25', "/movies?genreId=1' OR '1'='1", '/showtimes/..%2f..%2fetc%2fpasswd', '/movies/%3Cscript%3E']) {
    const r = await get(path);
    assert.ok([200, 400, 404].includes(r.status), `${path} -> ${r.status}`);
  }
  const phimTonTai = await (await get('/movies?q=%27%20OR%201%3D1%20--')).json();
  assert.equal(phimTonTai.data.length, 0); // chuỗi tấn công được coi là từ khóa tìm kiếm thường, không khớp phim nào
});

// ------------------------------------------------------------------------ JWT
test('⭐ JWT giả mạo bị từ chối: alg=none, ký sai khóa, và đúng khóa nhưng thuật toán khác HS256 (ghim thuật toán)', async () => {
  const sub = roles.users.ADMIN.id;
  const asAdmin = (token) => get('/admin/users', { Authorization: `Bearer ${token}` });
  assert.equal((await asAdmin(roles.token('ADMIN'))).status, 200); // đối chứng: token thật dùng được

  const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub, role: 'ADMIN', exp: 9_999_999_999 })).toString('base64url')}.`;
  assert.equal((await asAdmin(none)).status, 401);
  assert.equal((await asAdmin(jwt.sign({ role: 'ADMIN' }, 'sai-khoa-sai-khoa-sai-khoa-1234', { subject: sub, expiresIn: '1h' }))).status, 401);
  const hs512 = jwt.sign({ role: 'ADMIN' }, env.JWT_ACCESS_SECRET, { subject: sub, expiresIn: '1h', algorithm: 'HS512' }); // ĐÚNG khóa, khác thuật toán
  assert.equal((await asAdmin(hs512)).status, 401);
  assert.equal((await asAdmin('khong.phai.jwt')).status, 401);
  assert.equal((await get('/admin/users', { Authorization: 'Basic abc' })).status, 401);
});

// ------------------------------------------------------------- CẤU HÌNH PRODUCTION
const prodEnv = (extra = {}) => ({
  NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@db:5432/cinemind', CLIENT_URL: 'https://cinemind.example.com',
  JWT_ACCESS_SECRET: 'a8F3kQ9zLm2XvB7nR4tY6wC1eH5jD0pS', JWT_REFRESH_SECRET: 'Z1xV8bN3mK6qW9rT2yU5iO7pL4aS0dFg',
  VNP_TMN_CODE: 'ABCD1234', VNP_HASH_SECRET: 'HASHSECRETTHATSTHATLONGENOUGH123456', VNP_URL: 'https://pay.vnpay.vn/vpcpay.html',
  VNP_RETURN_URL: 'https://cinemind.example.com/payment/result', ...extra,
});
const problems = (source) => { const r = parseEnv(source); return r.success ? [] : r.error.issues.map((i) => i.path[0]); };

test('⭐ cấu hình production hợp lệ được chấp nhận; môi trường dev mặc định tắt cổng giả lập', () => {
  assert.deepEqual(problems(prodEnv()), []);
  const dev = parseEnv({ DATABASE_URL: 'x', JWT_ACCESS_SECRET: 'x'.repeat(16), JWT_REFRESH_SECRET: 'y'.repeat(16) });
  assert.equal(dev.success, true);
  assert.equal(dev.data.ENABLE_DEV_ROUTES, false);
  assert.equal(dev.data.NODE_ENV, 'development');
});

test('⭐ production TỪ CHỐI khởi động với cấu hình nguy hiểm: secret mẫu / ngắn / trùng nhau, bật cổng giả lập, HTTP, thiếu hay dùng VNPay giả', () => {
  assert.ok(problems(prodEnv({ JWT_ACCESS_SECRET: 'doi-thanh-chuoi-ngau-nhien-dai-abcdefghijkl' })).includes('JWT_ACCESS_SECRET')); // chuỗi mẫu trong .env.example
  assert.ok(problems(prodEnv({ JWT_REFRESH_SECRET: 'ngan-16-ky-tu-ok' })).includes('JWT_REFRESH_SECRET')); // < 32 ký tự
  assert.ok(problems(prodEnv({ JWT_REFRESH_SECRET: prodEnv().JWT_ACCESS_SECRET })).includes('JWT_REFRESH_SECRET')); // hai secret trùng nhau
  assert.ok(problems(prodEnv({ ENABLE_DEV_ROUTES: 'true' })).includes('ENABLE_DEV_ROUTES'));
  assert.ok(problems(prodEnv({ CLIENT_URL: 'http://cinemind.example.com' })).includes('CLIENT_URL'));
  assert.ok(problems(prodEnv({ VNP_HASH_SECRET: undefined })).includes('VNP_HASH_SECRET'));
  assert.ok(problems(prodEnv({ VNP_TMN_CODE: 'DEMO0001' })).includes('VNP_HASH_SECRET'));
  assert.ok(problems(prodEnv({ VNP_RETURN_URL: undefined })).includes('VNP_RETURN_URL'));
});

// -------------------------------------------------------------------- RATE LIMIT
test('rate limit: chặn khi vượt ngưỡng, tách theo IP, mở lại sau khi hết khung thời gian', async () => {
  const limiter = rateLimit({ windowMs: 80, max: 3, enabled: true });
  const hit = (ip) => { try { limiter({ ip }, {}, () => {}); return 'ok'; } catch (e) { return e.code; } };
  assert.deepEqual([hit('1.1.1.1'), hit('1.1.1.1'), hit('1.1.1.1'), hit('1.1.1.1')], ['ok', 'ok', 'ok', 'RATE_LIMITED']);
  assert.equal(hit('2.2.2.2'), 'ok'); // IP khác không bị ảnh hưởng
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(hit('1.1.1.1'), 'ok'); // hết khung: được gọi lại
});

test('rate limit tắt trong môi trường test (để test tích hợp không bị chặn) nhưng có thể bật tường minh', () => {
  const off = rateLimit({ windowMs: 1000, max: 1 }); // mặc định theo NODE_ENV=test
  let passed = 0;
  for (let i = 0; i < 5; i++) off({ ip: 'x' }, {}, () => { passed++; });
  assert.equal(passed, 5);
});
