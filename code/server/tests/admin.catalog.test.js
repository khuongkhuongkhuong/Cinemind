// Quản lý thể loại, combo, khuyến mãi (admin).
// Cần dữ liệu mẫu: chạy `npm run db:seed` trước.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { prisma } = await import('../src/config/prisma.js');
const { findPromotionByCode, assertPromotionUsable } = await import('../src/services/promotion.service.js');
const { default: app } = await import('../src/app.js');
const { createRoleUsers } = await import('./helpers/role-users.js');

const RUN = Date.now();
const DAY = 86_400_000;
let roles; let server; let base; let customer; let showtime;

const hdr = (role = 'ADMIN') => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${roles.token(role)}` });
const call = async (method, path, body, role) => {
  const res = await fetch(base + path, { method, headers: hdr(role), body: body && JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
};
const code = (r) => r.json?.error?.code;
const promoBody = (extra = {}) => ({
  code: `t${RUN}a`, name: 'Mã thử', discountType: 'PERCENT', discountValue: 10, maxDiscount: 30_000,
  startAt: new Date(Date.now() - DAY).toISOString(), endAt: new Date(Date.now() + DAY).toISOString(), ...extra,
});

before(async () => {
  roles = await createRoleUsers(prisma, `cat${RUN}`);
  customer = await prisma.user.create({ data: { email: `test-acat-${RUN}@example.com`, passwordHash: 'x', fullName: 'Test' } });
  showtime = await prisma.showtime.findFirst();
  server = app.listen(0);
  base = `http://localhost:${server.address().port}/api/v1`;
});

after(async () => {
  server.close();
  await prisma.order.deleteMany({ where: { userId: customer.id } }); // OrderCombo cascade
  await prisma.user.delete({ where: { id: customer.id } });
  await prisma.movie.deleteMany({ where: { title: { startsWith: `TestGenreMovie ${RUN}` } } });
  await prisma.genre.deleteMany({ where: { name: { startsWith: `TestGenre ${RUN}` } } });
  await prisma.combo.deleteMany({ where: { name: { startsWith: `TestCombo ${RUN}` } } });
  await prisma.promotion.deleteMany({ where: { code: { startsWith: `T${RUN}` } } });
  await roles.cleanup();
  await prisma.$disconnect();
});

test('phân quyền: không token 401; USER / STAFF 403 trên cả ba nhóm', async () => {
  for (const path of ['/admin/genres', '/admin/combos', '/admin/promotions']) {
    assert.equal((await fetch(base + path)).status, 401);
    assert.equal((await call('GET', path, undefined, 'USER')).status, 403);
    assert.equal((await call('GET', path, undefined, 'STAFF')).status, 403);
    assert.equal((await call('GET', path)).status, 200);
  }
});

// ------------------------------------------------------------------ THỂ LOẠI
test('thể loại: tạo, trùng tên -> 400 kèm details.fields.name, sửa, danh sách có movieCount', async () => {
  const name = `TestGenre ${RUN}`;
  const made = await call('POST', '/admin/genres', { name: `  ${name}  ` });
  assert.equal(made.status, 201);
  assert.equal(made.json.data.name, name); // đã cắt khoảng trắng
  const dup = await call('POST', '/admin/genres', { name });
  assert.equal(dup.status, 400);
  assert.ok(dup.json.error.details.fields.name);
  assert.equal((await call('POST', '/admin/genres', { name: '' })).status, 400);
  assert.equal((await call('POST', '/admin/genres', { name: 'X', extra: 1 })).status, 400);

  const id = made.json.data.id;
  const other = await call('POST', '/admin/genres', { name: `${name} B` });
  assert.equal((await call('PUT', `/admin/genres/${id}`, { name: `${name} B` })).status, 400); // đổi sang tên đã có
  assert.equal((await call('PUT', `/admin/genres/${id}`, { name: `${name} C` })).json.data.name, `${name} C`);
  assert.equal((await call('PUT', '/admin/genres/00000000-0000-4000-8000-000000000000', { name: 'Z' })).status, 404);

  const list = (await call('GET', '/admin/genres')).json.data;
  assert.ok(list.every((g) => Number.isInteger(g.movieCount)));
  assert.ok(list.find((g) => g.id === other.json.data.id));
});

test('⭐ xóa thể loại: đang gắn phim -> 409 RESOURCE_IN_USE (không âm thầm gỡ khỏi phim); chưa gắn -> 204', async () => {
  const genre = (await call('POST', '/admin/genres', { name: `TestGenre ${RUN} dùng` })).json.data;
  const movie = await prisma.movie.create({
    data: { title: `TestGenreMovie ${RUN}`, slug: `test-genre-movie-${RUN}`, searchKey: `testgenremovie ${RUN}`, description: 'x', durationMin: 90, ageRating: 'P', releaseDate: new Date('2026-12-01'), genres: { create: [{ genreId: genre.id }] } },
  });
  const blocked = await call('DELETE', `/admin/genres/${genre.id}`);
  assert.equal(blocked.status, 409);
  assert.equal(code(blocked), 'RESOURCE_IN_USE');
  assert.equal((await call('GET', '/admin/genres')).json.data.find((g) => g.id === genre.id).movieCount, 1);
  assert.equal(await prisma.movieGenre.count({ where: { movieId: movie.id } }), 1); // quan hệ còn nguyên

  const free = (await call('POST', '/admin/genres', { name: `TestGenre ${RUN} rảnh` })).json.data;
  assert.equal((await call('DELETE', `/admin/genres/${free.id}`)).status, 204);
  assert.equal((await call('DELETE', `/admin/genres/${free.id}`)).status, 404);
});

// -------------------------------------------------------------------- COMBO
test('combo: tạo, sửa từng phần, ngừng bán -> biến mất khỏi danh mục công khai nhưng vẫn ở danh sách admin', async () => {
  const made = await call('POST', '/admin/combos', { name: `TestCombo ${RUN}`, price: 55_000, description: 'Bắp + nước' });
  assert.equal(made.status, 201);
  assert.equal(made.json.data.isActive, true);
  const id = made.json.data.id;
  const publicList = async () => (await (await fetch(`${base}/combos`)).json()).data;
  assert.ok((await publicList()).some((c) => c.id === id));

  const upd = await call('PUT', `/admin/combos/${id}`, { price: 65_000 });
  assert.equal(upd.json.data.price, 65_000);
  assert.equal(upd.json.data.name, `TestCombo ${RUN}`); // trường không gửi giữ nguyên

  await call('PUT', `/admin/combos/${id}`, { isActive: false });
  assert.ok(!(await publicList()).some((c) => c.id === id));
  assert.ok((await call('GET', '/admin/combos')).json.data.some((c) => c.id === id && c.isActive === false));
});

test('combo: dữ liệu sai bị 400 (giá âm / lẻ, URL javascript:, trường lạ, body rỗng); id lạ 404', async () => {
  const bad = (body) => call('POST', '/admin/combos', { name: `TestCombo ${RUN} bad`, price: 1000, ...body }).then((r) => r.status);
  assert.equal(await bad({ price: -1 }), 400);
  assert.equal(await bad({ price: 1000.5 }), 400);
  assert.equal(await bad({ imageUrl: 'javascript:alert(1)' }), 400); // chặn XSS
  assert.equal(await bad({ id: 'tu-dat-id' }), 400);
  const made = (await call('POST', '/admin/combos', { name: `TestCombo ${RUN} ok`, price: 1000, imageUrl: 'https://example.com/a.png' })).json.data;
  assert.equal((await call('PUT', `/admin/combos/${made.id}`, {})).status, 400);
  assert.equal((await call('PUT', `/admin/combos/${made.id}`, { imageUrl: 'ftp://x' })).status, 400);
  assert.equal((await call('PUT', '/admin/combos/00000000-0000-4000-8000-000000000000', { price: 1 })).status, 404);
});

test('⭐ đổi giá combo KHÔNG ảnh hưởng đơn đã tạo (giá đã chốt, BR-14); combo đã bán thì không xóa được (409), chưa bán xóa được (204)', async () => {
  const combo = (await call('POST', '/admin/combos', { name: `TestCombo ${RUN} bán`, price: 50_000 })).json.data;
  const order = await prisma.order.create({
    data: { code: `${String(RUN).slice(-8)}CB`, userId: customer.id, showtimeId: showtime.id, expiresAt: new Date(Date.now() + 60_000), seatTotal: 0, total: 100_000 },
  });
  await prisma.orderCombo.create({ data: { orderId: order.id, comboId: combo.id, quantity: 2, unitPrice: 50_000 } });

  await call('PUT', `/admin/combos/${combo.id}`, { price: 999_000 });
  assert.equal((await prisma.orderCombo.findFirst({ where: { orderId: order.id } })).unitPrice, 50_000); // đơn cũ nguyên giá

  const blocked = await call('DELETE', `/admin/combos/${combo.id}`);
  assert.equal(blocked.status, 409);
  assert.equal(code(blocked), 'RESOURCE_IN_USE');
  const free = (await call('POST', '/admin/combos', { name: `TestCombo ${RUN} chưa bán`, price: 1000 })).json.data;
  assert.equal((await call('DELETE', `/admin/combos/${free.id}`)).status, 204);
});

// --------------------------------------------------------------- KHUYẾN MÃI
test('khuyến mãi: tạo (mã tự viết hoa), trùng mã -> 400 fields.code, mã có dấu cách / quá ngắn -> 400', async () => {
  const made = await call('POST', '/admin/promotions', promoBody());
  assert.equal(made.status, 201);
  assert.equal(made.json.data.code, `T${RUN}A`); // t...a -> T...A
  assert.equal(made.json.data.usedCount, 0);
  assert.equal(made.json.data.maxDiscount, 30_000);
  const dup = await call('POST', '/admin/promotions', promoBody({ code: `T${RUN}A` }));
  assert.equal(dup.status, 400);
  assert.ok(dup.json.error.details.fields.code);
  assert.equal((await call('POST', '/admin/promotions', promoBody({ code: 'có dấu cách' }))).status, 400);
  assert.equal((await call('POST', '/admin/promotions', promoBody({ code: 'ab' }))).status, 400);
});

test('⭐ khuyến mãi: kiểm tra ràng buộc chéo — % ngoài 1–100, maxDiscount với mã FIXED, hết hạn trước ngày bắt đầu', async () => {
  const fields = async (extra) => (await call('POST', '/admin/promotions', promoBody({ code: `T${RUN}X${Math.floor(Math.random() * 1e6)}`, ...extra }))).json.error?.details?.fields ?? {};
  assert.ok((await fields({ discountValue: 150 })).discountValue);
  assert.ok((await fields({ discountType: 'FIXED', discountValue: 50_000, maxDiscount: 10_000 })).maxDiscount);
  assert.ok((await fields({ endAt: new Date(Date.now() - 2 * DAY).toISOString() })).endAt);
  assert.equal((await call('POST', '/admin/promotions', promoBody({ code: `T${RUN}F`, discountType: 'FIXED', discountValue: 30_000, maxDiscount: undefined }))).status, 201);
});

test('khuyến mãi: sửa từng phần được kiểm tra SAU KHI trộn với dữ liệu cũ; không đổi được code / usedCount', async () => {
  const p = (await call('POST', '/admin/promotions', promoBody({ code: `T${RUN}B` }))).json.data;
  assert.equal((await call('PUT', `/admin/promotions/${p.id}`, { name: 'Tên mới', isActive: false })).json.data.name, 'Tên mới');
  // đổi sang FIXED trong khi maxDiscount (của PERCENT) vẫn còn -> mâu thuẫn
  const bad = await call('PUT', `/admin/promotions/${p.id}`, { discountType: 'FIXED' });
  assert.equal(bad.status, 400);
  assert.ok(bad.json.error.details.fields.maxDiscount);
  assert.equal((await call('PUT', `/admin/promotions/${p.id}`, { discountType: 'FIXED', maxDiscount: null, discountValue: 20_000 })).json.data.discountType, 'FIXED');
  // endAt phải sau startAt hiện có
  assert.equal((await call('PUT', `/admin/promotions/${p.id}`, { endAt: new Date(Date.now() - 5 * DAY).toISOString() })).status, 400);
  assert.equal((await call('PUT', `/admin/promotions/${p.id}`, { code: 'DOICODE' })).status, 400);
  assert.equal((await call('PUT', `/admin/promotions/${p.id}`, { usedCount: 0 })).status, 400);
  assert.equal((await call('PUT', '/admin/promotions/00000000-0000-4000-8000-000000000000', { name: 'x' })).status, 404);
});

test('⭐ mã do admin tạo dùng được ở luồng đặt vé (tra không phân biệt hoa-thường); tắt mã -> NOT_FOUND', async () => {
  const p = (await call('POST', '/admin/promotions', promoBody({ code: `T${RUN}C`, minOrderValue: 100_000 }))).json.data;
  const found = await findPromotionByCode({ code: `  t${RUN}c ` });
  assert.equal(found.id, p.id);
  await assertPromotionUsable({ promotion: found, userId: customer.id, subtotal: 150_000 }); // hợp lệ
  const small = await assertPromotionUsable({ promotion: found, userId: customer.id, subtotal: 50_000 }).catch((e) => e);
  assert.equal(small.details.reason, 'MIN_ORDER_NOT_MET');

  await call('PUT', `/admin/promotions/${p.id}`, { isActive: false });
  const off = await assertPromotionUsable({ promotion: await findPromotionByCode({ code: `T${RUN}C` }), userId: customer.id, subtotal: 150_000 }).catch((e) => e);
  assert.equal(off.details.reason, 'NOT_FOUND');
});

test('⭐ xóa mã: đã gắn vào đơn -> 409 RESOURCE_IN_USE (hãy tắt mã); chưa dùng -> 204', async () => {
  const used = (await call('POST', '/admin/promotions', promoBody({ code: `T${RUN}D` }))).json.data;
  await prisma.order.create({
    data: { code: `${String(RUN).slice(-8)}DB`, userId: customer.id, showtimeId: showtime.id, expiresAt: new Date(Date.now() + 60_000), seatTotal: 0, total: 0, promotionId: used.id },
  });
  const blocked = await call('DELETE', `/admin/promotions/${used.id}`);
  assert.equal(blocked.status, 409);
  assert.equal(code(blocked), 'RESOURCE_IN_USE');
  const free = (await call('POST', '/admin/promotions', promoBody({ code: `T${RUN}E` }))).json.data;
  assert.equal((await call('DELETE', `/admin/promotions/${free.id}`)).status, 204);
  assert.ok((await call('GET', '/admin/promotions')).json.data.some((x) => x.id === used.id));
});
