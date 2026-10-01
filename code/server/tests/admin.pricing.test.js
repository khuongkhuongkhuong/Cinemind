// Quản lý bảng giá và banner (admin).
// Bảng giá là dữ liệu DÙNG CHUNG (các test giữ ghế đọc phụ thu trực tiếp) nên test KHÔNG sửa thật: ghi trong transaction rồi rollback.
// Cần dữ liệu mẫu: chạy `npm run db:seed` trước.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { prisma } = await import('../src/config/prisma.js');
const pricing = await import('../src/services/adminPricing.service.js');
const { default: app } = await import('../src/app.js');
const { createRoleUsers } = await import('./helpers/role-users.js');

const RUN = Date.now();
const DAY = 86_400_000;
let roles; let server; let base;

const hdr = (role = 'ADMIN') => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${roles.token(role)}` });
const call = async (method, path, body, role) => {
  const res = await fetch(base + path, { method, headers: hdr(role), body: body && JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
};

before(async () => {
  roles = await createRoleUsers(prisma, `prc${RUN}`);
  server = app.listen(0);
  base = `http://localhost:${server.address().port}/api/v1`;
});
after(async () => {
  server.close();
  await prisma.banner.deleteMany({ where: { title: { startsWith: `TestBanner ${RUN}` } } });
  await roles.cleanup();
  await prisma.$disconnect();
});

// ----------------------------------------------------------------- BẢNG GIÁ
test('phân quyền: không token 401; USER / STAFF 403; ADMIN xem được', async () => {
  for (const path of ['/admin/pricing', '/admin/banners']) {
    assert.equal((await fetch(base + path)).status, 401);
    assert.equal((await call('GET', path, undefined, 'USER')).status, 403);
    assert.equal((await call('GET', path, undefined, 'STAFF')).status, 403);
    assert.equal((await call('GET', path)).status, 200);
  }
});

test('xem bảng giá: đủ 6 giá gốc (3 định dạng × 2 loại ngày) và 3 phụ thu, đúng BR-12 / BR-13 của dữ liệu mẫu', async () => {
  const { priceRules, surcharges } = (await call('GET', '/admin/pricing')).json.data;
  assert.equal(priceRules.length, 6);
  assert.deepEqual(priceRules.find((r) => r.format === 'F2D' && r.dayType === 'WEEKDAY'), { format: 'F2D', dayType: 'WEEKDAY', basePrice: 75_000 });
  assert.equal(priceRules.find((r) => r.format === 'IMAX' && r.dayType === 'WEEKEND').basePrice, 160_000);
  assert.deepEqual(surcharges.map((s) => [s.seatType, s.surcharge]), [['STANDARD', 0], ['VIP', 15_000], ['COUPLE', 20_000]]);
});

test('PUT với đúng giá trị hiện tại (không đổi gì): 200 và trả lại cùng bảng', async () => {
  const current = (await call('GET', '/admin/pricing')).json.data;
  const put = await call('PUT', '/admin/pricing', current);
  assert.equal(put.status, 200);
  assert.deepEqual(put.json.data, current);
});

test('⭐ cập nhật bảng giá: ghi cả bảng trong một transaction (kiểm rồi ROLLBACK, không sửa dữ liệu thật)', async () => {
  const before = await pricing.getPricing();
  const changed = {
    priceRules: before.priceRules.map((r) => ({ ...r, basePrice: r.basePrice + 1000 })),
    surcharges: before.surcharges.map((s) => ({ ...s, surcharge: s.surcharge + 500 })),
  };
  const ROLLBACK = new Error('rollback');
  await prisma.$transaction(async (tx) => {
    await pricing.applyPricing(tx, changed);
    const inside = await pricing.getPricing(tx);
    assert.deepEqual(inside, changed);
    throw ROLLBACK;
  }).catch((e) => { if (e !== ROLLBACK) throw e; });
  assert.deepEqual(await pricing.getPricing(), before); // rollback thật: giá không đổi
});

test('⭐ PUT thiếu ô / trùng ô / giá âm hoặc lẻ / trường lạ -> 400 (không bao giờ để bảng giá thiếu ô)', async () => {
  const current = (await call('GET', '/admin/pricing')).json.data;
  const put = (body) => call('PUT', '/admin/pricing', body).then((r) => r.status);
  assert.equal(await put({ ...current, priceRules: current.priceRules.slice(1) }), 400); // thiếu một giá gốc
  assert.equal(await put({ ...current, priceRules: [...current.priceRules.slice(1), current.priceRules[1]] }), 400); // trùng một ô, thiếu một ô
  assert.equal(await put({ ...current, surcharges: current.surcharges.slice(1) }), 400);
  assert.equal(await put({ ...current, priceRules: current.priceRules.map((r, i) => (i ? r : { ...r, basePrice: -1 })) }), 400);
  assert.equal(await put({ ...current, priceRules: current.priceRules.map((r, i) => (i ? r : { ...r, basePrice: 75_000.5 })) }), 400);
  assert.equal(await put({ ...current, priceRules: current.priceRules.map((r, i) => (i ? r : { ...r, format: 'F4D' })) }), 400);
  assert.equal(await put({ ...current, extra: 1 }), 400);
  assert.equal(await put({}), 400);
  assert.deepEqual((await call('GET', '/admin/pricing')).json.data, current); // chưa có gì bị đổi
});

// -------------------------------------------------------------------- BANNER
const bannerBody = (extra = {}) => ({ title: `TestBanner ${RUN}`, imageUrl: 'https://example.com/b.jpg', ...extra });

test('banner: tạo / sửa từng phần / xóa; ảnh và link nhận http(s) hoặc đường dẫn nội bộ', async () => {
  const made = await call('POST', '/admin/banners', bannerBody({ linkUrl: '/movies/nha-ba-tu', sortOrder: 5 }));
  assert.equal(made.status, 201);
  const b = made.json.data;
  assert.deepEqual([b.isActive, b.sortOrder, b.linkUrl, b.startAt], [true, 5, '/movies/nha-ba-tu', null]);
  assert.equal((await call('POST', '/admin/banners', bannerBody({ imageUrl: '/banners/promo-9.jpg' }))).status, 201); // đường dẫn nội bộ như dữ liệu seed

  const upd = await call('PUT', `/admin/banners/${b.id}`, { title: `TestBanner ${RUN} mới`, linkUrl: null });
  assert.equal(upd.json.data.title, `TestBanner ${RUN} mới`);
  assert.equal(upd.json.data.linkUrl, null);
  assert.equal(upd.json.data.imageUrl, 'https://example.com/b.jpg'); // trường không gửi giữ nguyên
  assert.equal((await call('PUT', `/admin/banners/${b.id}`, {})).status, 400);
  assert.equal((await call('PUT', '/admin/banners/00000000-0000-4000-8000-000000000000', { title: 'x' })).status, 404);

  assert.equal((await call('DELETE', `/admin/banners/${b.id}`)).status, 204);
  assert.equal((await call('DELETE', `/admin/banners/${b.id}`)).status, 404);
});

test('⭐ banner: URL nguy hiểm bị 400 — javascript:, data:, //evil.com (open redirect), ftp:, đường dẫn thoát ra ngoài', async () => {
  const bad = async (extra) => (await call('POST', '/admin/banners', bannerBody(extra))).status;
  assert.equal(await bad({ imageUrl: 'javascript:alert(1)' }), 400);
  assert.equal(await bad({ imageUrl: 'data:text/html,<script>1</script>' }), 400);
  assert.equal(await bad({ linkUrl: '//evil.example.com/x' }), 400); // trình duyệt hiểu là dẫn sang trang lạ
  assert.equal(await bad({ linkUrl: 'JaVaScRiPt:alert(1)' }), 400);
  assert.equal(await bad({ linkUrl: 'ftp://example.com/f' }), 400);
  assert.equal(await bad({ imageUrl: 'banners/khong-co-gach-dau.jpg' }), 400);
  assert.equal(await bad({ imageUrl: '/ok.jpg', linkUrl: '/<script>' }), 400);
  assert.equal(await bad({ id: 'tu-dat-id' }), 400); // trường lạ
});

test('banner: mốc thời gian kiểm tra SAU KHI trộn với bản cũ; endAt phải sau startAt', async () => {
  const start = new Date(Date.now() + DAY).toISOString();
  const b = (await call('POST', '/admin/banners', bannerBody({ startAt: start }))).json.data;
  assert.equal((await call('POST', '/admin/banners', bannerBody({ startAt: start, endAt: new Date(Date.now()).toISOString() }))).status, 400);
  const bad = await call('PUT', `/admin/banners/${b.id}`, { endAt: new Date(Date.now()).toISOString() }); // trước startAt đã lưu
  assert.equal(bad.status, 400);
  assert.ok(bad.json.error.details.fields.endAt);
  assert.equal((await call('PUT', `/admin/banners/${b.id}`, { endAt: new Date(Date.now() + 5 * DAY).toISOString() })).status, 200);
});

test('⭐ banner công khai: chỉ hiện banner đang bật, trong khung thời gian, theo thứ tự sortOrder; admin thấy tất cả', async () => {
  const mk = async (suffix, extra) => (await call('POST', '/admin/banners', bannerBody({ title: `TestBanner ${RUN} ${suffix}`, ...extra }))).json.data;
  const second = await mk('hai', { sortOrder: 9_001 });
  const first = await mk('một', { sortOrder: 9_000 });
  const off = await mk('tắt', { isActive: false, sortOrder: 9_002 });
  const future = await mk('tương lai', { startAt: new Date(Date.now() + DAY).toISOString(), sortOrder: 9_003 });
  const expired = await mk('hết hạn', { startAt: new Date(Date.now() - 3 * DAY).toISOString(), endAt: new Date(Date.now() - DAY).toISOString(), sortOrder: 9_004 });

  const pub = (await (await fetch(`${base}/banners`)).json()).data;
  const ids = pub.map((b) => b.id);
  assert.deepEqual(ids.filter((id) => [first.id, second.id].includes(id)), [first.id, second.id]); // đúng thứ tự sortOrder
  for (const hidden of [off, future, expired]) assert.ok(!ids.includes(hidden.id), `${hidden.title} không được hiện công khai`);

  const adminIds = (await call('GET', '/admin/banners')).json.data.map((b) => b.id);
  for (const b of [first, second, off, future, expired]) assert.ok(adminIds.includes(b.id));
});
