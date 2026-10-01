// Cổng giả lập thanh toán (/dev) phải được bật CÓ CHỦ ĐÍCH. File riêng vì cần chạy với NODE_ENV=development.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'development'; // đúng chế độ mà trước đây tự động bật cổng giả lập
delete process.env.ENABLE_DEV_ROUTES; // không bật tường minh (kể cả khi .env của máy có đặt)
const { default: app } = await import('../src/app.js');
const { devRoutesEnabled } = await import('../src/routes/index.js');
const { prisma } = await import('../src/config/prisma.js');

let server; let base;
before(() => {
  server = app.listen(0);
  base = `http://localhost:${server.address().port}/api/v1`;
});
after(async () => {
  server.close();
  await prisma.$disconnect();
});

test('⭐ NODE_ENV=development nhưng KHÔNG đặt ENABLE_DEV_ROUTES: cổng giả lập tắt, route không tồn tại', async () => {
  assert.equal(devRoutesEnabled, false);
  const res = await fetch(`${base}/dev/payments/X-1/simulate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ result: 'SUCCESS' }),
  });
  assert.equal(res.status, 404);
  assert.match((await res.json()).error.message, /Không tìm thấy POST/); // route không có (khác "không có giao dịch")
});
