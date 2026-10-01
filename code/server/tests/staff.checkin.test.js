// Soát vé: tra cứu và check-in (BR-33, BR-34), mỗi vé dùng đúng một lần.
// Cần dữ liệu mẫu: chạy `npm run db:seed` trước.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { prisma } = await import('../src/config/prisma.js');
const { lookupTicket, checkIn, evaluateCheckIn } = await import('../src/services/ticket.service.js');
const { normalizeTicketCode } = await import('../src/lib/code.js');
const { default: app } = await import('../src/app.js');
const { signAccessToken } = await import('../src/lib/jwt.js');

const minute = 60_000;
const RUN = Date.now();
let showtime; // suất có sẵn trong seed (dùng với `now` giả lập)
let nearShowtime; // suất tạo riêng bắt đầu sau 5 phút (dùng giờ thật cho test HTTP)
let customer; let staff;
let n = 0;

const failErr = (p) => p.then(() => null, (e) => e);
// Tạo thẳng đơn trong DB (không qua giữ ghế) để khỏi tranh ghế; chỉ cần đủ cho luồng soát vé.
const makeOrder = (data = {}, st = showtime) => prisma.order.create({
  data: {
    code: `T${RUN}${n++}`.slice(-10).toUpperCase(), userId: customer.id, showtimeId: st.id, status: 'PAID', paidAt: new Date(),
    expiresAt: new Date(Date.now() + 10 * minute), seatTotal: 0, total: 0, ...data,
  },
});
const at = (offsetMin) => new Date(showtime.startTime.getTime() + offsetMin * minute);

before(async () => {
  [showtime] = await prisma.showtime.findMany({ where: { status: 'OPEN' }, orderBy: { startTime: 'desc' }, skip: 5, take: 1 });
  nearShowtime = await prisma.showtime.create({
    data: {
      ...Object.fromEntries(['movieId', 'roomId', 'format', 'audio', 'basePrice'].map((k) => [k, showtime[k]])),
      startTime: new Date(Date.now() + 5 * minute), endTime: new Date(Date.now() + 120 * minute),
    },
  });
  const mk = (role) => prisma.user.create({ data: { email: `test-staff-${RUN}-${role}@example.com`, passwordHash: 'x', fullName: role, role } });
  [customer, staff] = [await mk('USER'), await mk('STAFF')];
});

after(async () => {
  await prisma.order.deleteMany({ where: { userId: customer.id } });
  await prisma.showtime.delete({ where: { id: nearShowtime.id } });
  await prisma.user.deleteMany({ where: { id: { in: [customer.id, staff.id] } } });
  await prisma.$disconnect();
});

test('normalizeTicketCode: nhận mã trần, nội dung QR, chữ thường, có khoảng trắng', () => {
  assert.equal(normalizeTicketCode('K7Q2M9XA'), 'K7Q2M9XA');
  assert.equal(normalizeTicketCode('CINEMIND:K7Q2M9XA'), 'K7Q2M9XA');
  assert.equal(normalizeTicketCode('  cinemind:k7q2m9xa '), 'K7Q2M9XA');
});

test('⭐ BR-34 evaluateCheckIn: đúng ranh giới ±30 phút (gồm cả hai đầu mút)', () => {
  const order = { status: 'PAID', checkedInAt: null, showtime: { startTime: showtime.startTime, status: 'OPEN' } };
  const verdict = (offset) => evaluateCheckIn(order, at(offset));
  assert.deepEqual(verdict(-31), { canCheckIn: false, reason: 'TOO_EARLY' });
  assert.equal(verdict(-30).canCheckIn, true); // đúng 30 phút trước: được
  assert.equal(verdict(0).canCheckIn, true);
  assert.equal(verdict(30).canCheckIn, true); // đúng 30 phút sau: được
  assert.deepEqual(verdict(31), { canCheckIn: false, reason: 'TOO_LATE' });
});

test('evaluateCheckIn: thứ tự ưu tiên — chưa trả tiền > đã dùng > suất hủy > ngoài giờ', () => {
  const base = { status: 'PAID', checkedInAt: null, showtime: { startTime: showtime.startTime, status: 'OPEN' } };
  const now = at(0);
  assert.equal(evaluateCheckIn({ ...base, status: 'PENDING' }, now).reason, 'NOT_PAID');
  for (const status of ['CANCELLED', 'EXPIRED', 'REFUND_PENDING', 'REFUNDED']) {
    assert.equal(evaluateCheckIn({ ...base, status }, now).reason, 'NOT_PAID'); // chỉ PAID mới vào được
  }
  assert.equal(evaluateCheckIn({ ...base, checkedInAt: new Date() }, at(999)).reason, 'ALREADY_USED');
  assert.equal(evaluateCheckIn({ ...base, showtime: { ...base.showtime, status: 'CANCELLED' } }, now).reason, 'SHOWTIME_CANCELLED');
});

test('lookupTicket: trả vé + canCheckIn; vé lạ -> NOT_FOUND; mã QR / chữ thường đều tra được', async () => {
  const o = await makeOrder();
  const found = await lookupTicket({ code: `cinemind:${o.code.toLowerCase()}`, now: at(-10) });
  assert.equal(found.order.code, o.code);
  assert.equal(found.canCheckIn, true);
  assert.equal(found.reason, undefined);
  const early = await lookupTicket({ code: o.code, now: at(-120) });
  assert.deepEqual([early.canCheckIn, early.reason], [false, 'TOO_EARLY']);
  assert.equal((await failErr(lookupTicket({ code: 'KHONGCO99' }))).code, 'NOT_FOUND');
});

test('check-in thành công: ghi checkedInAt + người soát; quét lần hai -> TICKET_ALREADY_USED kèm giờ đã quét', async () => {
  const o = await makeOrder();
  const done = await checkIn({ code: o.code, staffId: staff.id, now: at(5) });
  assert.equal(new Date(done.checkedInAt).getTime(), at(5).getTime());
  const row = await prisma.order.findUnique({ where: { id: o.id } });
  assert.equal(row.checkedInById, staff.id);

  const again = await failErr(checkIn({ code: o.code, staffId: staff.id, now: at(6) }));
  assert.equal(again.code, 'TICKET_ALREADY_USED');
  assert.equal(new Date(again.details.checkedInAt).getTime(), at(5).getTime());
  assert.match(again.message, /\d{2}:\d{2}/);
  assert.equal((await lookupTicket({ code: o.code, now: at(6) })).reason, 'ALREADY_USED');
});

test('các lỗi từ chối: chưa trả tiền, quá sớm, quá muộn, suất bị hủy', async () => {
  const pending = await makeOrder({ status: 'PENDING', paidAt: null });
  assert.equal((await failErr(checkIn({ code: pending.code, staffId: staff.id, now: at(0) }))).code, 'TICKET_NOT_PAID');

  const o = await makeOrder();
  const early = await failErr(checkIn({ code: o.code, staffId: staff.id, now: at(-31) }));
  assert.equal(early.code, 'CHECKIN_NOT_ALLOWED');
  assert.equal(early.details.reason, 'TOO_EARLY');
  const late = await failErr(checkIn({ code: o.code, staffId: staff.id, now: at(31) }));
  assert.equal(late.details.reason, 'TOO_LATE');
  assert.equal((await prisma.order.findUnique({ where: { id: o.id } })).checkedInAt, null); // bị từ chối thì không đánh dấu

  await prisma.showtime.update({ where: { id: nearShowtime.id }, data: { status: 'CANCELLED' } });
  try {
    const c = await makeOrder({}, nearShowtime);
    assert.equal((await failErr(checkIn({ code: c.code, staffId: staff.id }))).details.reason, 'SHOWTIME_CANCELLED');
  } finally {
    await prisma.showtime.update({ where: { id: nearShowtime.id }, data: { status: 'OPEN' } });
  }
});

test('⭐ 10 nhân viên quét CÙNG MỘT vé cùng lúc: đúng 1 người thành công, 9 người nhận TICKET_ALREADY_USED', async () => {
  const o = await makeOrder();
  const results = await Promise.all(
    Array.from({ length: 10 }, () => checkIn({ code: o.code, staffId: staff.id, now: at(0) }).then(() => 'ok', (e) => e.code)),
  );
  assert.equal(results.filter((r) => r === 'ok').length, 1);
  assert.equal(results.filter((r) => r === 'TICKET_ALREADY_USED').length, 9);
});

test('HTTP: phân quyền — không token 401, USER 403, STAFF và ADMIN dùng được; qua đường QR "CINEMIND:<mã>"', async () => {
  const o = await makeOrder({}, nearShowtime);
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}/api/v1/staff/tickets`;
  const as = (id, role) => ({ headers: { Authorization: `Bearer ${signAccessToken({ id, role })}` } });
  try {
    assert.equal((await fetch(`${base}/${o.code}`)).status, 401);
    const forbidden = await fetch(`${base}/${o.code}`, as(customer.id, 'USER'));
    assert.equal(forbidden.status, 403);
    assert.equal((await forbidden.json()).error.code, 'FORBIDDEN');
    assert.equal((await fetch(`${base}/${o.code}/check-in`, { method: 'POST', ...as(customer.id, 'USER') })).status, 403);

    const look = await (await fetch(`${base}/${o.code}`, as(staff.id, 'STAFF'))).json();
    assert.equal(look.data.canCheckIn, true); // suất bắt đầu sau 5 phút, trong khung giờ thật
    const qr = encodeURIComponent(`CINEMIND:${o.code}`);
    const res = await fetch(`${base}/${qr}/check-in`, { method: 'POST', ...as(staff.id, 'ADMIN') });
    assert.equal(res.status, 200);
    assert.ok((await res.json()).data.checkedInAt);
    const twice = await fetch(`${base}/${o.code}/check-in`, { method: 'POST', ...as(staff.id, 'STAFF') });
    assert.equal(twice.status, 409);
    assert.equal((await twice.json()).error.code, 'TICKET_ALREADY_USED');
  } finally {
    server.close();
  }
});
