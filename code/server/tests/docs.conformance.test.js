// Đối chiếu docs/04-api-contract.md với code: mọi endpoint trong bảng mục 2 phải tồn tại và có đúng yêu cầu đăng nhập / phân quyền;
// mọi mã lỗi ở mục 1.2 phải khớp utils/errorCodes.js. Nếu lệch, test này thất bại → sửa docs TRƯỚC (quy trình của nhóm) hoặc sửa code.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
const { default: app } = await import('../src/app.js');
const { prisma } = await import('../src/config/prisma.js');
const { ERROR_CODES } = await import('../src/utils/errorCodes.js');
const { createRoleUsers } = await import('./helpers/role-users.js');

const DOC = readFileSync(new URL('../../../docs/04-api-contract.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const METHODS = 'GET|POST|PUT|PATCH|DELETE';

// Endpoint ĐÃ GHI trong docs nhưng CHƯA làm (mức ưu tiên Should/Could theo docs). Test khẳng định chúng thật sự chưa có:
// khi ai đó làm xong thì phải xóa khỏi danh sách này — để lệch docs/code luôn hiển thị, không bị lãng quên.
const NOT_IMPLEMENTED = new Set([]);

// ---- đọc bảng endpoint từ docs ----
function section(startPattern) {
  const start = DOC.search(startPattern);
  assert.ok(start >= 0, `không tìm thấy mục ${startPattern}`);
  const rest = DOC.slice(start + 1);
  const next = rest.search(/\n##+ /);
  return rest.slice(0, next < 0 ? undefined : next);
}
function parseSimpleTable(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const m = line.match(new RegExp(`^\\| (${METHODS}) \\| \`(/[^\`]*)\` \\| ([^|]+) \\|`));
    if (m) rows.push({ method: m[1], path: m[2], who: m[3].replace(/\*/g, '').trim() });
  }
  return rows;
}
const endpoints = [];
for (const [pattern, label] of [[/### 2\.1 /, '2.1'], [/### 2\.2 /, '2.2'], [/### 2\.3 /, '2.3'], [/### 2\.4 /, '2.4'], [/### 2\.5 /, '2.5'], [/### 2\.6 /, '2.6']]) {
  for (const r of parseSimpleTable(section(pattern))) endpoints.push({ ...r, section: label });
}
// Mục 2.7: mỗi ô liệt kê nhiều endpoint ngăn bởi " · ", ví dụ "GET/POST /admin/genres" hoặc "PATCH /admin/orders/:id/refund".
for (const line of section(/### 2\.7 /).split('\n')) {
  if (!line.startsWith('| ') || line.startsWith('| Nhóm') || line.startsWith('|---')) continue;
  const cell = line.split('|')[2] ?? '';
  for (const token of cell.split(' · ')) {
    const m = token.replace(/`/g, '').trim().match(new RegExp(`^((?:${METHODS})(?:/(?:${METHODS}))*) +(/[^\\s?]+)`));
    if (m) for (const method of m[1].split('/')) endpoints.push({ method, path: m[2], who: 'ADMIN', section: '2.7' });
  }
}
// ---- trạng thái chạy ----
let server; let base; let roles;
before(async () => {
  roles = await createRoleUsers(prisma, `doc${Date.now()}`);
  server = app.listen(0);
  base = `http://localhost:${server.address().port}/api/v1`;
});
after(async () => {
  server.close();
  await roles.cleanup();
  await prisma.$disconnect();
});

const UUID = '00000000-0000-4000-8000-000000000000';
const fill = (path) => path.replace(/:slug/g, 'khong-co-phim').replace(/:code/g, 'ABCD1234').replace(/:txnRef/g, 'ABC-1').replace(/:\w+/g, UUID);
async function call({ method, path }, token) {
  const res = await fetch(base + fill(path), {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: ['POST', 'PUT', 'PATCH'].includes(method) ? '{}' : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 204 hoặc không phải JSON */ }
  // Route KHÔNG tồn tại: notFoundHandler trả 404 với câu "Không tìm thấy <METHOD> <url>" (khác "Không tìm thấy phim/đơn...").
  const routeMissing = res.status === 404 && new RegExp(`^Không tìm thấy (${METHODS}) /api/`).test(json?.error?.message ?? '');
  return { status: res.status, code: json?.error?.code, routeMissing };
}
const key = (e) => `${e.method} ${e.path}`;

test('docs đọc được: có đủ các nhóm endpoint (đề phòng parser hỏng làm test "qua" vì không kiểm gì)', () => {
  assert.ok(endpoints.length >= 70, `chỉ đọc được ${endpoints.length} endpoint từ docs`);
  for (const s of ['2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '2.7']) assert.ok(endpoints.some((e) => e.section === s), `thiếu mục ${s}`);
  assert.ok(endpoints.some((e) => key(e) === 'GET /admin/reports/revenue'));
  assert.ok(endpoints.some((e) => key(e) === 'POST /staff/tickets/:code/check-in'));
});

test('⭐ mọi endpoint ghi trong docs đều tồn tại (trừ danh sách NOT_IMPLEMENTED đã thừa nhận); và danh sách đó không lỗi thời', async () => {
  const missing = []; const staleAllowlist = [];
  for (const e of endpoints) {
    if (e.who === 'Dev' || e.who === 'Trình duyệt') continue; // cổng giả lập: chỉ bật có chủ đích (xem security.devroutes.test.js)
    const token = e.who === 'ADMIN' ? roles.token('ADMIN') : e.who === 'STAFF' ? roles.token('STAFF') : roles.token('USER');
    const { routeMissing } = await call(e, token);
    if (routeMissing && !NOT_IMPLEMENTED.has(key(e))) missing.push(key(e));
    if (!routeMissing && NOT_IMPLEMENTED.has(key(e))) staleAllowlist.push(key(e));
  }
  assert.deepEqual(missing, [], `docs ghi nhưng code chưa có: ${missing.join(', ')}`);
  assert.deepEqual(staleAllowlist, [], `đã làm xong, hãy xóa khỏi NOT_IMPLEMENTED: ${staleAllowlist.join(', ')}`);
});

test('⭐ yêu cầu đăng nhập đúng như docs: "USER"/"Owner" không token -> 401; "Public" không bị chặn; "Cookie" không cookie -> 401; "VNPay" không cần token', async () => {
  const wrong = [];
  for (const e of endpoints) {
    if (NOT_IMPLEMENTED.has(key(e)) || ['Dev', 'Trình duyệt', 'ADMIN', 'STAFF'].includes(e.who)) continue;
    const { status, code } = await call(e);
    if (['USER', 'Owner'].includes(e.who) && !(status === 401 && code === 'UNAUTHORIZED')) wrong.push(`${key(e)} (${e.who}) -> ${status}`);
    if (['Public', 'VNPay'].includes(e.who) && [401, 403].includes(status)) wrong.push(`${key(e)} (${e.who}) -> ${status}`);
    if (e.who === 'Cookie' && status !== 401) wrong.push(`${key(e)} (Cookie) -> ${status}`);
  }
  assert.deepEqual(wrong, []);
});

test('⭐ phân quyền đúng như docs: route STAFF -> không token 401, USER 403, STAFF qua được; route ADMIN -> không token 401, USER và STAFF đều 403, ADMIN qua được', async () => {
  const wrong = [];
  for (const e of endpoints.filter((x) => ['STAFF', 'ADMIN'].includes(x.who) && !NOT_IMPLEMENTED.has(key(x)))) {
    const noToken = (await call(e)).status;
    const asUser = (await call(e, roles.token('USER'))).status;
    const asStaff = (await call(e, roles.token('STAFF'))).status;
    const asAdmin = (await call(e, roles.token('ADMIN'))).status;
    if (noToken !== 401) wrong.push(`${key(e)}: không token -> ${noToken}`);
    if (asUser !== 403) wrong.push(`${key(e)}: USER -> ${asUser}`);
    if (e.who === 'ADMIN' && asStaff !== 403) wrong.push(`${key(e)}: STAFF -> ${asStaff} (phải 403)`);
    if (e.who === 'STAFF' && [401, 403].includes(asStaff)) wrong.push(`${key(e)}: STAFF bị chặn -> ${asStaff}`);
    if ([401, 403].includes(asAdmin)) wrong.push(`${key(e)}: ADMIN bị chặn -> ${asAdmin}`);
  }
  assert.deepEqual(wrong, []);
});

test('⭐ bảng mã lỗi mục 1.2 khớp errorCodes.js: cùng tập mã và cùng HTTP status', () => {
  const documented = new Map();
  for (const line of section(/### 1\.2 /).split('\n')) {
    const m = line.match(/^\| (\d{3}) \| `([A-Z_]+)`/);
    if (m) documented.set(m[2], Number(m[1]));
  }
  assert.ok(documented.size >= 20, 'parser không đọc được bảng mã lỗi');
  const inCode = new Map(Object.entries(ERROR_CODES).map(([code, def]) => [code, def.status]));
  assert.deepEqual([...documented.keys()].filter((c) => !inCode.has(c)), [], 'mã có trong docs nhưng thiếu trong code');
  assert.deepEqual([...inCode.keys()].filter((c) => !documented.has(c)), [], 'mã có trong code nhưng thiếu trong docs');
  for (const [code, status] of documented) assert.equal(inCode.get(code), status, `${code}: docs ${status} ≠ code ${inCode.get(code)}`);
});

test('bảng lịch sử thay đổi hợp đồng: phiên bản liên tục, không trùng, tăng dần', () => {
  const versions = [...DOC.matchAll(/^\| \d\d\/\d\d\/\d{4} \| (\d+)\.(\d+) \|/gm)].map((m) => Number(m[2]));
  assert.ok(versions.length >= 10);
  assert.deepEqual(versions, [...versions].sort((a, b) => a - b), 'phiên bản không theo thứ tự');
  assert.equal(new Set(versions).size, versions.length, 'có phiên bản bị trùng');
  assert.deepEqual(versions, versions.map((_, i) => i), 'phiên bản bị nhảy cóc / thiếu');
});
