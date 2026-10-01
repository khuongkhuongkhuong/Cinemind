// Cần dữ liệu mẫu: chạy `npm run db:seed` trước.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { default: app } = await import('../src/app.js');
const { prisma } = await import('../src/config/prisma.js');

let server;
let base;
before(() => {
  server = app.listen(0);
  base = `http://localhost:${server.address().port}/api/v1`;
});
after(async () => {
  server.close();
  await prisma.$disconnect();
});

const get = async (path) => {
  const res = await fetch(base + path);
  return { status: res.status, json: await res.json() };
};

test('GET /movies lọc theo status + phân trang đúng meta', async () => {
  const r = await get('/movies?status=NOW_SHOWING&pageSize=5&page=2');
  assert.equal(r.status, 200);
  assert.equal(r.json.data.length, 5);
  assert.ok(r.json.data.every((m) => m.status === 'NOW_SHOWING'));
  assert.equal(r.json.meta.page, 2);
  assert.equal(r.json.meta.totalPages, Math.ceil(r.json.meta.total / 5));
});

test('tìm kiếm không phân biệt dấu và hoa/thường: "NHA BA" ra "Nhà Bà Tư"', async () => {
  const r = await get('/movies?q=NHA%20BA');
  assert.ok(r.json.data.some((m) => m.slug === 'nha-ba-tu'));
});

test('danh sách sắp xếp theo ngày phát hành mới -> cũ', async () => {
  const dates = (await get('/movies?pageSize=100')).json.data.map((m) => m.releaseDate);
  assert.deepEqual(dates, [...dates].sort().reverse());
});

test('GET /movies/:slug: có đủ trường chi tiết; slug lạ -> 404 NOT_FOUND', async () => {
  const ok = await get('/movies/nha-ba-tu');
  assert.equal(ok.json.data.title, 'Nhà Bà Tư');
  assert.ok('description' in ok.json.data && 'trailerUrl' in ok.json.data);
  const missing = await get('/movies/khong-co-phim-nay');
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error.code, 'NOT_FOUND');
});

test('tham số sai -> 400 VALIDATION_ERROR (status lạ, pageSize > 100)', async () => {
  const r = await get('/movies?status=XYZ&pageSize=999');
  assert.equal(r.status, 400);
  assert.ok(r.json.error.details.fields.status);
  assert.ok(r.json.error.details.fields.pageSize);
});

test('GET /cinemas?cityId chỉ trả rạp của thành phố đó', async () => {
  const cities = (await get('/cities')).json.data;
  const hanoi = cities.find((c) => c.name === 'Hà Nội');
  const r = await get(`/cinemas?cityId=${hanoi.id}`);
  assert.equal(r.json.data.length, 2);
  assert.ok(r.json.data.every((c) => c.cityId === hanoi.id));
});
