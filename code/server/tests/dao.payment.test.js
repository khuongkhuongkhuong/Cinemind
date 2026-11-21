// DAO của thanh toán (payment / order / promotion / user) — các câu ⭐ của IPN. Mỗi hàm là MỘT thao tác truy vấn:
// test kiểm ĐÚNG điều kiện của từng câu, nhất là tính IDEMPOTENT (giành giao dịch PENDING -> SUCCESS) và chống bán trùng ghế.
// Cần dữ liệu mẫu: chạy `npm run db:seed` trước.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { prisma } = await import('../src/config/prisma.js');
const paymentDao = await import('../src/dao/payment.dao.js');
const orderDao = await import('../src/dao/order.dao.js');
const promotionDao = await import('../src/dao/promotion.dao.js');
const userDao = await import('../src/dao/user.dao.js');
const showtimeDao = await import('../src/dao/showtime.dao.js');

const minute = 60_000;
const DAY = 24 * 60 * minute;
const RUN = Date.now();
let room; let showtime; let user; let other; let seats; let n = 0;
const seatId = (l) => seats[l].id;
const future = () => new Date(Date.now() + 10 * minute);
const past = () => new Date(Date.now() - minute);

before(async () => {
  const cinema = await prisma.cinema.findFirst({ where: { name: { startsWith: 'Cinemind' }, isActive: true }, orderBy: { name: 'asc' } });
  const movie = await prisma.movie.findFirst({ where: { status: 'NOW_SHOWING', description: { not: 'Mô tả thử' } } });
  room = await prisma.room.create({ data: { cinemaId: cinema.id, name: `TestRoom-${RUN}-daopay` } });
  await prisma.seat.createMany({ data: ['A1', 'A2', 'A3', 'A4'].map((l) => ({ roomId: room.id, row: l[0], number: Number(l[1]), type: 'STANDARD' })) });
  seats = Object.fromEntries((await prisma.seat.findMany({ where: { roomId: room.id } })).map((s) => [`${s.row}${s.number}`, s]));
  const start = new Date(Math.ceil((Date.now() + 110 * DAY) / (60 * minute)) * 60 * minute);
  showtime = await showtimeDao.insertShowtime({ movieId: movie.id, roomId: room.id, startTime: start, endTime: new Date(start.getTime() + 2 * 60 * minute), format: 'F2D', audio: 'SUBTITLE', basePrice: 80_000 });
  user = await prisma.user.create({ data: { email: `test-daopay-${RUN}-a@example.com`, passwordHash: 'x', fullName: 'Test A' } });
  other = await prisma.user.create({ data: { email: `test-daopay-${RUN}-b@example.com`, passwordHash: 'x', fullName: 'Test B' } });
});
after(async () => {
  await prisma.payment.deleteMany({ where: { order: { userId: { in: [user.id, other.id] } } } });
  await prisma.order.deleteMany({ where: { userId: { in: [user.id, other.id] } } }); // Ticket xóa theo (cascade)
  await prisma.promotion.deleteMany({ where: { code: { startsWith: `TDP${RUN}` } } });
  await prisma.showtime.deleteMany({ where: { roomId: room.id } });
  await prisma.seat.deleteMany({ where: { roomId: room.id } });
  await prisma.room.delete({ where: { id: room.id } });
  await prisma.user.deleteMany({ where: { id: { in: [user.id, other.id] } } });
  await prisma.$disconnect();
});

// Vé RELEASED (không chiếm ghế): test này chỉ kiểm câu lệnh của payment / order; việc chiếm / bán ghế kiểm ở dao.ticket.test.js.
const mkOrder = async (who, labels = ['A1'], extra = {}) => {
  const o = await orderDao.insertOrder({
    code: `DP${RUN}${process.pid}${n++}`.slice(-10), userId: who.id, source: 'WEB', expiresAt: future(), seatTotal: 100_000, total: 100_000, ...extra,
  });
  await prisma.ticket.createMany({
    data: labels.map((l) => ({ orderId: o.id, showtimeId: showtime.id, seatId: seatId(l), seatLabel: l, seatType: 'STANDARD', price: 50_000, status: 'RELEASED' })),
  });
  return o;
};
const mkPayment = (order, extra = {}) => paymentDao.insertPayment({ orderId: order.id, txnRef: `${order.code}-1`, amount: order.total, bankCode: null, ...extra });
const FIELDS = { responseCode: '00', providerTxnNo: '14000001', bankCode: 'NCB', rawData: { vnp_TxnRef: 'x' } };

test('payment DAO: insertPayment (PENDING) + countPaymentsOfOrder + findPaymentByTxnRef; trùng txnRef -> P2002 đi xuyên DAO', async () => {
  const o = await mkOrder(user);
  assert.equal(await paymentDao.countPaymentsOfOrder(o.id), 0);
  const p = await mkPayment(o, { bankCode: 'NCB' });
  assert.deepEqual([p.status, p.amount, p.bankCode, p.txnRef], ['PENDING', 100_000, 'NCB', `${o.code}-1`]);
  assert.equal(await paymentDao.countPaymentsOfOrder(o.id), 1);
  assert.equal((await paymentDao.findPaymentByTxnRef(p.txnRef)).id, p.id);
  assert.equal(await paymentDao.findPaymentByTxnRef('KHONG-CO-1'), null);
  const dup = await mkPayment(o).then(() => null, (e) => e);
  assert.equal(dup.code, 'P2002');
  assert.equal(await paymentDao.countPaymentsOfOrder(o.id), 1);
});

test('⭐ claimPaymentSuccess: 10 lần SONG SONG chỉ 1 lần giành được (idempotent); ghi đủ trường; giao dịch đã SUCCESS / FAILED -> 0 và KHÔNG bị ghi đè', async () => {
  const o = await mkOrder(user);
  const p = await mkPayment(o);
  const paidAt = new Date();
  const counts = await Promise.all(Array.from({ length: 10 }, () => paymentDao.claimPaymentSuccess({ id: p.id, paidAt, fields: FIELDS })));
  assert.equal(counts.filter((c) => c === 1).length, 1);
  assert.equal(counts.filter((c) => c === 0).length, 9);
  const row = await paymentDao.findPaymentByTxnRef(p.txnRef);
  assert.deepEqual([row.status, row.responseCode, row.providerTxnNo, row.bankCode], ['SUCCESS', '00', '14000001', 'NCB']);
  assert.equal(row.paidAt.getTime(), paidAt.getTime());
  assert.deepEqual(row.rawData, FIELDS.rawData);

  // đã SUCCESS: lần giành khác (dù dữ liệu khác) không ghi đè
  assert.equal(await paymentDao.claimPaymentSuccess({ id: p.id, paidAt: new Date(), fields: { ...FIELDS, providerTxnNo: 'KHAC' } }), 0);
  assert.equal((await paymentDao.findPaymentByTxnRef(p.txnRef)).providerTxnNo, '14000001');

  // đã FAILED: không giành được
  const o2 = await mkOrder(other, ['A2']);
  const p2 = await mkPayment(o2);
  assert.equal(await paymentDao.markPaymentFailedIfPending({ id: p2.id, fields: { responseCode: '24', providerTxnNo: null, rawData: { a: 1 } } }), 1);
  assert.equal(await paymentDao.claimPaymentSuccess({ id: p2.id, paidAt: new Date(), fields: FIELDS }), 0);
  assert.equal((await paymentDao.findPaymentByTxnRef(p2.txnRef)).status, 'FAILED');
});

test('⭐ claimPaymentSuccess: bankCode không gửi (undefined) thì GIỮ bankCode đã có; markPaymentFailedIfPending ghi mã lỗi, chỉ khi còn PENDING (đã SUCCESS thì 0 và giữ nguyên)', async () => {
  const o = await mkOrder(user, ['A3']);
  const p = await mkPayment(o, { bankCode: 'VCB' });
  await paymentDao.claimPaymentSuccess({ id: p.id, paidAt: new Date(), fields: { responseCode: '00', providerTxnNo: '1', rawData: {} } }); // không có bankCode
  assert.equal((await paymentDao.findPaymentByTxnRef(p.txnRef)).bankCode, 'VCB');
  assert.equal(await paymentDao.markPaymentFailedIfPending({ id: p.id, fields: { responseCode: '99', providerTxnNo: null, rawData: {} } }), 0);
  const row = await paymentDao.findPaymentByTxnRef(p.txnRef);
  assert.deepEqual([row.status, row.responseCode], ['SUCCESS', '00']);

  const o2 = await mkOrder(other, ['A4']);
  const p2 = await mkPayment(o2);
  const counts = await Promise.all(Array.from({ length: 5 }, () => paymentDao.markPaymentFailedIfPending({ id: p2.id, fields: { responseCode: '24', providerTxnNo: '7', rawData: { x: 1 } } })));
  assert.equal(counts.filter((c) => c === 1).length, 1);
  const failed = await paymentDao.findPaymentByTxnRef(p2.txnRef);
  assert.deepEqual([failed.status, failed.responseCode, failed.providerTxnNo], ['FAILED', '24', '7']);
});

test('order DAO (thanh toán): getOrderById đọc đơn thô; setOrderStatus đổi trạng thái; markOrderPaid ghi PAID + paidAt', async () => {
  const o = await mkOrder(user, ['A1', 'A2']);
  assert.equal((await orderDao.getOrderById(o.id)).code, o.code);
  assert.equal(await orderDao.getOrderById('00000000-0000-4000-8000-000000000000'), null);
  await orderDao.setOrderStatus(o.id, 'REFUND_PENDING');
  assert.equal((await orderDao.getOrderStatus(o.id)).status, 'REFUND_PENDING');
  const at = new Date('2026-11-01T03:00:00Z');
  await orderDao.markOrderPaid(o.id, at);
  const row = await prisma.order.findUnique({ where: { id: o.id } });
  assert.deepEqual([row.status, row.paidAt.getTime()], ['PAID', at.getTime()]);
});

test('⭐ incrementUsedCount / addPoints: cộng NGUYÊN TỬ — 10 lần song song cộng đúng 10 lần (không mất cập nhật)', async () => {
  const promo = await prisma.promotion.create({
    data: { code: `TDP${RUN}`, name: 'Test', discountType: 'FIXED', discountValue: 1000, startAt: new Date(Date.now() - DAY), endAt: new Date(Date.now() + DAY) },
  });
  await Promise.all(Array.from({ length: 10 }, () => promotionDao.incrementUsedCount(promo.id)));
  assert.equal((await prisma.promotion.findUnique({ where: { id: promo.id } })).usedCount, 10);

  await Promise.all(Array.from({ length: 10 }, () => userDao.addPoints(user.id, 3)));
  assert.equal((await userDao.findUserById(user.id)).points, 30);
});
