// Báo cáo doanh thu theo ngày / phim / rạp (FR-37). Dùng cửa sổ thời gian trong QUÁ KHỨ (tháng 3/2025)
// nên không lẫn với đơn do các test khác tạo (đơn của họ có paidAt là hiện tại).
// Cần dữ liệu mẫu: chạy `npm run db:seed` trước.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { prisma } = await import('../src/config/prisma.js');
const { getRevenueReport } = await import('../src/services/report.service.js');
const { default: app } = await import('../src/app.js');
const { signAccessToken } = await import('../src/lib/jwt.js');
const { createRoleUsers } = await import('./helpers/role-users.js');

const RUN = Date.now();
let user; let roles; let st1; let st2;
let n = 0;

const failCode = (p) => p.then(() => null, (e) => e.code);
const rows = (groupBy, from = '2025-03-10', to = '2025-03-12') => getRevenueReport({ from, to, groupBy });

// Tạo đơn trực tiếp trong DB với đúng paidAt / tổng tiền / số ghế mong muốn.
async function makeOrder({ showtime, status = 'PAID', paidAt, total, seats }) {
  const order = await prisma.order.create({
    data: {
      code: `P${RUN}${n++}`.slice(-10).toUpperCase(), userId: user.id, showtimeId: showtime.id, status,
      paidAt: new Date(paidAt), expiresAt: new Date('2025-03-01T00:00:00Z'), seatTotal: total, total,
    },
  });
  const roomSeats = await prisma.seat.findMany({ where: { roomId: showtime.roomId }, take: seats, orderBy: [{ row: 'asc' }, { number: 'asc' }] });
  await prisma.orderSeat.createMany({
    data: roomSeats.map((s) => ({ orderId: order.id, seatId: s.id, seatLabel: `${s.row}${s.number}`, seatType: s.type, price: Math.floor(total / seats) })),
  });
  return order;
}

before(async () => {
  user = await prisma.user.create({ data: { email: `test-rep-${RUN}@example.com`, passwordHash: 'x', fullName: 'Test' } });
  roles = await createRoleUsers(prisma, `rep${RUN}`);
  const all = await prisma.showtime.findMany({ include: { room: true } });
  st1 = all[0];
  st2 = all.find((s) => s.movieId !== st1.movieId && s.room.cinemaId !== st1.room.cinemaId); // khác phim VÀ khác rạp

  await makeOrder({ showtime: st1, paidAt: '2025-03-10T03:00:00Z', total: 200_000, seats: 2 }); // 10/03 10:00 VN
  await makeOrder({ showtime: st1, paidAt: '2025-03-10T17:30:00Z', total: 100_000, seats: 1 }); // 11/03 00:30 VN (qua nửa đêm giờ VN)
  await makeOrder({ showtime: st2, paidAt: '2025-03-12T16:59:59Z', total: 350_000, seats: 3 }); // 12/03 23:59:59 VN (giây cuối của ngày cuối)
  await makeOrder({ showtime: st2, paidAt: '2025-03-12T17:00:00Z', total: 999_000, seats: 1 }); // 13/03 00:00 VN: NGOÀI khoảng
  for (const status of ['REFUNDED', 'REFUND_PENDING', 'CANCELLED', 'EXPIRED', 'PENDING']) {
    await makeOrder({ showtime: st1, status, paidAt: '2025-03-11T05:00:00Z', total: 777_000, seats: 1 }); // không phải PAID: không tính
  }
});

after(async () => {
  await prisma.order.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await roles.cleanup();
  await prisma.$disconnect();
});

test('⭐ theo ngày: chỉ tính đơn PAID; ngày tính theo giờ VN (00:30 VN thuộc ngày hôm sau); gồm cả giây cuối ngày `to`', async () => {
  const r = await rows('day');
  assert.deepEqual(r, [
    { key: '2025-03-10', label: '2025-03-10', revenue: 200_000, ticketCount: 2, orderCount: 1 },
    { key: '2025-03-11', label: '2025-03-11', revenue: 100_000, ticketCount: 1, orderCount: 1 }, // 17:30 UTC = 00:30 VN
    { key: '2025-03-12', label: '2025-03-12', revenue: 350_000, ticketCount: 3, orderCount: 1 },
  ]);
});

test('theo ngày: điền cả ngày không có doanh thu bằng 0 để vẽ biểu đồ liên tục; đơn lúc 00:00 VN ngày kế tiếp bị loại', async () => {
  const r = await rows('day', '2025-03-09', '2025-03-13');
  assert.deepEqual(r.map((x) => [x.key, x.revenue]), [
    ['2025-03-09', 0], ['2025-03-10', 200_000], ['2025-03-11', 100_000], ['2025-03-12', 350_000], ['2025-03-13', 999_000],
  ]); // ngày 13 CÓ đơn 999.000 (00:00 VN) vì khoảng giờ này đã gồm 13/03
  const narrow = await rows('day', '2025-03-10', '2025-03-12');
  assert.ok(narrow.every((x) => x.revenue !== 999_000));
});

test('theo phim: gộp đúng, xếp theo doanh thu giảm dần, label là tên phim', async () => {
  const r = await rows('movie');
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((x) => [x.revenue, x.ticketCount, x.orderCount]), [[350_000, 3, 1], [300_000, 3, 2]]);
  const [movie2, movie1] = await Promise.all([
    prisma.movie.findUnique({ where: { id: st2.movieId } }), prisma.movie.findUnique({ where: { id: st1.movieId } }),
  ]);
  assert.deepEqual(r.map((x) => x.label), [movie2.title, movie1.title]);
  assert.deepEqual(r.map((x) => x.key), [movie2.id, movie1.id]);
});

test('theo rạp: gộp đúng; tổng ba cách nhóm đều bằng nhau (cùng một tập đơn)', async () => {
  const byCinema = await rows('cinema');
  assert.equal(byCinema.length, 2);
  const sum = (list) => list.reduce((s, x) => s + x.revenue, 0);
  assert.equal(sum(byCinema), 650_000);
  assert.equal(sum(await rows('movie')), sum(await rows('day')));
  assert.equal(byCinema.reduce((s, x) => s + x.orderCount, 0), 3);
});

test('khoảng không có đơn: theo ngày toàn số 0, theo phim/rạp là mảng rỗng', async () => {
  const day = await rows('day', '2025-01-01', '2025-01-03');
  assert.equal(day.length, 3);
  assert.ok(day.every((x) => x.revenue === 0 && x.orderCount === 0));
  assert.deepEqual(await rows('movie', '2025-01-01', '2025-01-03'), []);
});

test('khoảng ngày sai: from > to, hoặc quá 366 ngày -> VALIDATION_ERROR', async () => {
  assert.equal(await failCode(rows('day', '2025-03-12', '2025-03-10')), 'VALIDATION_ERROR');
  assert.equal(await failCode(rows('day', '2023-01-01', '2025-01-01')), 'VALIDATION_ERROR');
  assert.equal((await rows('day', '2024-03-01', '2025-03-01')).length, 366); // đúng giới hạn thì được
});

test('HTTP: chỉ ADMIN (401/403 với người khác); mặc định 30 ngày gần nhất theo ngày; tham số sai 400', async () => {
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}/api/v1/admin/reports/revenue`;
  const hdr = (role) => ({ headers: { Authorization: `Bearer ${roles.token(role)}` } });
  try {
    assert.equal((await fetch(base)).status, 401);
    assert.equal((await fetch(base, hdr('USER'))).status, 403);
    assert.equal((await fetch(base, hdr('STAFF'))).status, 403);

    const def = await (await fetch(base, hdr('ADMIN'))).json();
    assert.equal(def.data.length, 30); // không truyền gì: 30 ngày kết thúc hôm nay
    assert.equal(def.data[29].key, new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10));

    const r = await (await fetch(`${base}?from=2025-03-10&to=2025-03-12&groupBy=movie`, hdr('ADMIN'))).json();
    assert.equal(r.success, true);
    assert.equal(r.data[0].revenue, 350_000);
    assert.equal((await fetch(`${base}?groupBy=week`, hdr('ADMIN'))).status, 400);
    assert.equal((await fetch(`${base}?from=10-03-2025`, hdr('ADMIN'))).status, 400);
    assert.equal((await fetch(`${base}?from=2025-03-12&to=2025-03-10`, hdr('ADMIN'))).status, 400);
  } finally {
    server.close();
  }
});
