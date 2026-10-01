// Combo (BR-20), khuyến mãi (BR-21..24) và tính tiền một chỗ duy nhất (recalcOrder).
// Cần dữ liệu mẫu: chạy `npm run db:seed` trước.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { prisma } = await import('../src/config/prisma.js');
const { env } = await import('../src/config/env.js');
const { holdSeats, setCombos, applyPromotion, removePromotion, cancelOrder } = await import('../src/services/booking.service.js');
const { calcDiscount } = await import('../src/services/promotion.service.js');
const { createPayment, confirmPayment } = await import('../src/services/payment.service.js');
const { sign } = await import('../src/lib/vnpay.js');
const { default: app } = await import('../src/app.js');
const { signAccessToken } = await import('../src/lib/jwt.js');

const RUN = Date.now();
const DAY = 86_400_000;
let showtime;
let seats;
let comboA; let comboB; // combo riêng của test, không đụng combo seed
const users = [];
const promos = {};
let seatCursor = 0;

const EXPIRED_OR_SWEPT = ['ORDER_EXPIRED', 'ORDER_NOT_PENDING'];
const failCode = (promise) => promise.then(() => null, (e) => e.code);
const failErr = (promise) => promise.then(() => null, (e) => e);
const newUser = async () => {
  const u = await prisma.user.create({ data: { email: `test-cp-${RUN}-${users.length}@example.com`, passwordHash: 'x', fullName: 'Test' } });
  users.push(u);
  return u;
};
// Mỗi test lấy 2 ghế thường MỚI (hàng A–C) để không tranh ghế với test khác.
const freshSeats = () => {
  const pick = seats.filter((s) => s.type === 'STANDARD').slice(seatCursor, seatCursor + 2);
  seatCursor += 2;
  return pick.map((s) => s.id);
};
async function newOrder() {
  const user = await newUser();
  const order = await holdSeats({ userId: user.id, showtimeId: showtime.id, seatIds: freshSeats() });
  return { user, order, ctx: { userId: user.id, orderId: order.id } };
}
const row = (id) => prisma.order.findUnique({ where: { id } });

before(async () => {
  [showtime] = await prisma.showtime.findMany({ where: { status: 'OPEN', startTime: { lt: new Date(Date.now() + 30 * 86_400_000) } }, orderBy: { startTime: 'desc' }, skip: 4, take: 1 });
  seats = (await prisma.seat.findMany({ where: { roomId: showtime.roomId } }))
    .sort((a, b) => a.row.localeCompare(b.row) || a.number - b.number);
  comboA = await prisma.combo.create({ data: { name: `TestA-${RUN}`, price: 50_000 } });
  comboB = await prisma.combo.create({ data: { name: `TestB-${RUN}`, price: 30_000 } });
  const now = Date.now();
  const base = { discountType: 'FIXED', discountValue: 10_000, startAt: new Date(now - DAY), endAt: new Date(now + DAY) };
  const make = (key, data) => prisma.promotion.create({ data: { ...base, code: `T${RUN}${key}`, name: `Test ${key}`, ...data } })
    .then((p) => { promos[key] = p; });
  await Promise.all([
    make('PCT', { discountType: 'PERCENT', discountValue: 10, maxDiscount: 30_000, minOrderValue: 100_000 }),
    make('FIX', { discountValue: 40_000 }),
    make('HUGE', { discountValue: 10_000_000 }),
    make('MIN', { minOrderValue: 1_000_000 }),
    make('FUT', { startAt: new Date(now + DAY), endAt: new Date(now + 2 * DAY) }),
    make('OLD', { startAt: new Date(now - 2 * DAY), endAt: new Date(now - DAY) }),
    make('LIM', { usageLimit: 1, usedCount: 1 }),
    make('OFF', { isActive: false }),
    make('ONCE', {}),
    make('KEEP', { minOrderValue: 2 * showtime.basePrice + 1 }), // vừa quá giá 2 vé: cần thêm combo mới đủ điều kiện
  ]);
});

after(async () => {
  const userIds = users.map((u) => u.id);
  await prisma.payment.deleteMany({ where: { order: { userId: { in: userIds } } } });
  await prisma.order.deleteMany({ where: { userId: { in: userIds } } }); // OrderCombo, SeatLock cascade
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.promotion.deleteMany({ where: { id: { in: Object.values(promos).map((p) => p.id) } } });
  await prisma.combo.deleteMany({ where: { id: { in: [comboA.id, comboB.id] } } });
  await prisma.$disconnect();
});

test('calcDiscount (hàm thuần): % có trần, số tiền cố định, không vượt tổng tiền', () => {
  const pct = { discountType: 'PERCENT', discountValue: 10, maxDiscount: 30_000 };
  assert.equal(calcDiscount(pct, 200_000), 20_000);
  assert.equal(calcDiscount(pct, 900_000), 30_000); // chạm trần
  assert.equal(calcDiscount({ discountType: 'PERCENT', discountValue: 15, maxDiscount: null }, 99_999), 14_999); // làm tròn xuống
  assert.equal(calcDiscount({ discountType: 'FIXED', discountValue: 50_000, maxDiscount: null }, 30_000), 30_000); // không âm
});

test('combo: tính tổng, THAY CẢ DANH SÁCH, [] bỏ hết, giá được chốt vào đơn (BR-14)', async () => {
  const { ctx, order } = await newOrder();
  const seatTotal = order.seatTotal;

  const a = await setCombos({ ...ctx, items: [{ comboId: comboA.id, quantity: 2 }, { comboId: comboB.id, quantity: 1 }] });
  assert.equal(a.comboTotal, 2 * 50_000 + 30_000);
  assert.equal(a.total, seatTotal + 130_000);
  assert.deepEqual(a.combos.map((c) => [c.quantity, c.unitPrice, c.subtotal]).sort(), [[1, 30_000, 30_000], [2, 50_000, 100_000]]);

  // admin đổi giá combo SAU đó: đơn cũ không đổi
  await prisma.combo.update({ where: { id: comboA.id }, data: { price: 999_000 } });
  const same = await setCombos({ ...ctx, items: [{ comboId: comboB.id, quantity: 3 }] }); // thay hẳn danh sách (A biến mất)
  assert.equal(same.combos.length, 1);
  assert.equal(same.comboTotal, 90_000);
  await prisma.combo.update({ where: { id: comboA.id }, data: { price: 50_000 } });

  const cleared = await setCombos({ ...ctx, items: [] });
  assert.equal(cleared.comboTotal, 0);
  assert.equal(cleared.total, seatTotal);
});

test('combo: sai số lượng / trùng / không tồn tại -> VALIDATION_ERROR; người khác -> FORBIDDEN', async () => {
  const { ctx, user } = await newOrder();
  const bad = (items) => failErr(setCombos({ ...ctx, items }));
  assert.equal((await bad([{ comboId: comboA.id, quantity: 11 }])).code, 'VALIDATION_ERROR'); // BR-20: tối đa 10
  assert.equal((await bad([{ comboId: comboA.id, quantity: 0 }])).code, 'VALIDATION_ERROR');
  assert.equal((await bad([{ comboId: comboA.id, quantity: 1 }, { comboId: comboA.id, quantity: 1 }])).code, 'VALIDATION_ERROR');
  assert.ok((await bad([{ comboId: '00000000-0000-4000-8000-000000000000', quantity: 1 }])).details.fields.items);
  const stranger = await newUser();
  assert.equal(await failCode(setCombos({ userId: stranger.id, orderId: ctx.orderId, items: [] })), 'FORBIDDEN');
  assert.equal(user.id, ctx.userId);
});

test('khuyến mãi: % bị chặn bởi trần; số tiền cố định; không bao giờ làm tổng âm', async () => {
  const { ctx, order } = await newOrder();
  const subtotal = order.seatTotal;

  const pct = await applyPromotion({ ...ctx, code: promos.PCT.code.toLowerCase() }); // không phân biệt hoa/thường
  assert.equal(pct.discount, Math.min(Math.floor(subtotal / 10), 30_000));
  assert.equal(pct.total, subtotal - pct.discount);
  assert.deepEqual(pct.promotion, { code: promos.PCT.code, name: promos.PCT.name, discount: pct.discount });

  // thêm combo thì giảm giá tính lại trên tổng mới (BR-23: áp trên vé + combo)
  const withCombo = await setCombos({ ...ctx, items: [{ comboId: comboA.id, quantity: 10 }] });
  assert.equal(withCombo.discount, Math.min(Math.floor((subtotal + 500_000) / 10), 30_000));

  const huge = await applyPromotion({ ...ctx, code: promos.HUGE.code }); // BR-23: mã mới THAY mã cũ
  assert.equal(huge.total, 0);
  assert.equal(huge.discount, subtotal + 500_000);

  const removed = await removePromotion(ctx);
  assert.equal(removed.promotion, null);
  assert.equal(removed.discount, 0);
  assert.equal(removed.total, subtotal + 500_000);
});

test('⭐ PROMO_INVALID kèm đúng details.reason cho từng trường hợp (BR-22)', async () => {
  const { ctx } = await newOrder();
  const reason = async (code) => (await failErr(applyPromotion({ ...ctx, code }))).details?.reason;
  assert.equal(await reason('KHONGCOMA'), 'NOT_FOUND');
  assert.equal(await reason(promos.OFF.code), 'NOT_FOUND');
  assert.equal(await reason(promos.FUT.code), 'NOT_STARTED');
  assert.equal(await reason(promos.OLD.code), 'EXPIRED');
  assert.equal(await reason(promos.LIM.code), 'USAGE_LIMIT_REACHED');
  assert.equal(await reason(promos.MIN.code), 'MIN_ORDER_NOT_MET');

  // ALREADY_USED: user này đã có đơn PAID dùng mã ONCE
  const { user, order } = await newOrder();
  await prisma.order.update({ where: { id: order.id }, data: { status: 'PAID', promotionId: promos.ONCE.id } });
  const second = await holdSeats({ userId: user.id, showtimeId: showtime.id, seatIds: freshSeats() });
  const err = await failErr(applyPromotion({ userId: user.id, orderId: second.id, code: promos.ONCE.code }));
  assert.equal(err.code, 'PROMO_INVALID');
  assert.equal(err.details.reason, 'ALREADY_USED');
});

test('đổi combo làm đơn dưới mức tối thiểu thì mã bị GỠ tự động (không trả theo mã không đủ điều kiện)', async () => {
  const { ctx, order } = await newOrder();
  await setCombos({ ...ctx, items: [{ comboId: comboA.id, quantity: 1 }] }); // 2 vé + 50.000 > mức tối thiểu
  const applied = await applyPromotion({ ...ctx, code: promos.KEEP.code });
  assert.equal(applied.discount, 10_000);

  const dropped = await setCombos({ ...ctx, items: [] }); // về lại đúng giá 2 vé: dưới mức tối thiểu
  assert.equal(dropped.promotion, null);
  assert.equal(dropped.discount, 0);
  assert.equal(dropped.total, order.seatTotal);
});

test('đơn đã hủy / hết hạn không đổi được combo hay mã', async () => {
  const a = await newOrder();
  await cancelOrder(a.ctx);
  assert.equal(await failCode(setCombos({ ...a.ctx, items: [] })), 'ORDER_NOT_PENDING');
  assert.equal(await failCode(applyPromotion({ ...a.ctx, code: promos.FIX.code })), 'ORDER_NOT_PENDING');

  const b = await newOrder();
  await prisma.order.update({ where: { id: b.order.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
  // Test file khác có thể quét cron giữa chừng (PENDING quá hạn -> EXPIRED): cả hai mã đều là từ chối đúng.
  assert.ok(EXPIRED_OR_SWEPT.includes(await failCode(setCombos({ ...b.ctx, items: [] }))));
  assert.ok(EXPIRED_OR_SWEPT.includes(await failCode(removePromotion(b.ctx))));
});

const ipn = (payment) => {
  const q = {
    vnp_TmnCode: env.VNP_TMN_CODE, vnp_Amount: String(payment.amount * 100), vnp_BankCode: 'NCB',
    vnp_TxnRef: payment.txnRef, vnp_TransactionNo: '14000001', vnp_ResponseCode: '00', vnp_TransactionStatus: '00',
  };
  q.vnp_SecureHash = sign(q, env.VNP_HASH_SECRET);
  return q;
};

test('⭐ thanh toán đúng số tiền sau combo + mã: PAID, usedCount tăng ĐÚNG khi thanh toán (BR-24), không phải khi áp mã', async () => {
  const { ctx, user } = await newOrder();
  await setCombos({ ...ctx, items: [{ comboId: comboA.id, quantity: 2 }] });
  const priced = await applyPromotion({ ...ctx, code: promos.FIX.code });
  assert.equal((await prisma.promotion.findUnique({ where: { id: promos.FIX.id } })).usedCount, 0); // áp mã chưa trừ lượt

  const { txnRef } = await createPayment({ ...ctx });
  const payment = await prisma.payment.findUnique({ where: { txnRef } });
  assert.equal(payment.amount, priced.total); // số tiền gửi VNPay = tổng đơn do server tính
  assert.equal((await confirmPayment({ query: ipn(payment) })).RspCode, '00');

  assert.equal((await row(ctx.orderId)).status, 'PAID');
  assert.equal((await prisma.promotion.findUnique({ where: { id: promos.FIX.id } })).usedCount, 1);
  assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).points, Math.floor(priced.total / 10_000));
});

test('⭐ khách đổi combo SAU khi tạo link thanh toán rồi trả theo link cũ: KHÔNG ghi PAID, đơn -> REFUND_PENDING', async () => {
  const { ctx } = await newOrder();
  const { txnRef } = await createPayment({ ...ctx }); // link ứng với tổng tiền cũ
  await setCombos({ ...ctx, items: [{ comboId: comboA.id, quantity: 1 }] }); // tổng đổi
  const payment = await prisma.payment.findUnique({ where: { txnRef } });

  assert.equal((await confirmPayment({ query: ipn(payment) })).RspCode, '00'); // vẫn báo 00 để VNPay ngừng gọi lại
  const o = await row(ctx.orderId);
  assert.equal(o.status, 'REFUND_PENDING');
  assert.equal(await prisma.seatLock.count({ where: { orderId: ctx.orderId } }), 0);
  assert.equal((await prisma.payment.findUnique({ where: { id: payment.id } })).status, 'SUCCESS'); // khoản thu được ghi nhận
});

test('HTTP: PUT combos, POST/DELETE promotion; mã sai -> 422 PROMO_INVALID kèm reason', async () => {
  const { user, order } = await newOrder();
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}/api/v1/orders/${order.id}`;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${signAccessToken({ id: user.id, role: 'USER' })}` };
  try {
    const put = await fetch(`${base}/combos`, { method: 'PUT', headers, body: JSON.stringify({ items: [{ comboId: comboB.id, quantity: 2 }] }) });
    assert.equal(put.status, 200);
    assert.equal((await put.json()).data.comboTotal, 60_000);

    const bad = await fetch(`${base}/promotion`, { method: 'POST', headers, body: JSON.stringify({ code: 'KHONGCO' }) });
    assert.equal(bad.status, 422);
    assert.equal((await bad.json()).error.details.reason, 'NOT_FOUND');

    const ok = await fetch(`${base}/promotion`, { method: 'POST', headers, body: JSON.stringify({ code: promos.FIX.code }) });
    assert.equal((await ok.json()).data.discount, 40_000);
    const del = await fetch(`${base}/promotion`, { method: 'DELETE', headers });
    assert.equal((await del.json()).data.promotion, null);

    assert.equal((await fetch(`${base}/combos`, { method: 'PUT', headers, body: JSON.stringify({}) })).status, 400);
  } finally {
    server.close();
  }
});
