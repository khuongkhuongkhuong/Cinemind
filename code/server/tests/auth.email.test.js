// Xác minh email và quên mật khẩu (FR-18a, FR-18b, BR-40 → BR-42). Cần dữ liệu mẫu: chạy `npm run db:seed` trước.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { prisma } = await import('../src/config/prisma.js');
const authSvc = await import('../src/services/auth.service.js');
const codeSvc = await import('../src/services/emailCode.service.js');
const orderSvc = await import('../src/services/order.service.js');
const { outbox } = await import('../src/lib/mailer.js');
const { default: app } = await import('../src/app.js');

const RUN = Date.now();
const PASSWORD = 'mat-khau-rat-dai-1';
const minute = 60_000;
let server; let base; let n = 0; let movie; let room; let showtime; let seat;

before(async () => {
  // Suất riêng của file test này: không giành ghế với các test chạy song song.
  const cinema = await prisma.cinema.findFirst({ where: { isActive: true } });
  movie = await prisma.movie.create({
    data: {
      title: `Mail Movie ${RUN}`, slug: `mail-movie-${RUN}`, searchKey: `mail movie ${RUN}`, description: 'Mô tả thử',
      durationMin: 90, ageRating: 'P', status: 'COMING_SOON', releaseDate: new Date('2026-01-01'),
    },
  });
  room = await prisma.room.create({ data: { cinemaId: cinema.id, name: `TestRoom-${RUN}-mail` } });
  seat = await prisma.seat.create({ data: { roomId: room.id, row: 'A', number: 1, type: 'STANDARD' } });
  const startTime = new Date(Date.now() + 200 * 24 * 3600_000);
  showtime = await prisma.showtime.create({
    data: { movieId: movie.id, roomId: room.id, startTime, endTime: new Date(startTime.getTime() + 105 * minute), format: 'F2D', audio: 'SUBTITLE', basePrice: 75000 },
  });
  server = app.listen(0);
  base = `http://localhost:${server.address().port}/api/v1`;
});
after(async () => {
  server.close();
  const users = await prisma.user.findMany({ where: { email: { startsWith: `test-mail-${RUN}-` } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.order.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } }); // EmailCode, RefreshToken xóa theo (cascade)
  await prisma.showtime.delete({ where: { id: showtime.id } });
  await prisma.seat.deleteMany({ where: { roomId: room.id } });
  await prisma.room.delete({ where: { id: room.id } });
  await prisma.movie.delete({ where: { id: movie.id } });
  await prisma.$disconnect();
});

const newEmail = () => `test-mail-${RUN}-${n++}@example.com`;
const register = async (email = newEmail()) => ({ email, ...(await authSvc.register({ email, password: PASSWORD, fullName: 'Test' })) });
const mailsTo = (email) => outbox.filter((m) => m.to === email);
const lastCode = (email) => mailsTo(email).at(-1).text.match(/\b(\d{6})\b/)[1];
const wrong = (code) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');
const failure = (p) => p.then(() => assert.fail('phải lỗi'), (e) => e);
const post = (path, body, token) => fetch(base + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: JSON.stringify(body ?? {}),
});

test('⭐ đăng ký công khai: chưa xác minh, gửi mã 6 số; DB chỉ lưu bản băm', async () => {
  const { email, user } = await register();
  assert.equal(user.emailVerified, false);
  assert.equal(mailsTo(email).length, 1);
  const code = lastCode(email);
  const row = await prisma.emailCode.findFirst({ where: { userId: user.id } });
  assert.equal(row.purpose, 'VERIFY_EMAIL');
  assert.ok(!row.codeHash.includes(code) && row.codeHash.length === 64);
  const ttl = row.expiresAt - row.sentAt;
  assert.equal(ttl, 10 * minute);
});

test('tài khoản tạo thẳng (mẫu, nhân viên do admin tạo) coi như đã xác minh', async () => {
  const user = await prisma.user.create({ data: { email: newEmail(), passwordHash: 'x', fullName: 'Có sẵn' } });
  assert.ok(user.emailVerifiedAt);
});

test('nhập đúng mã: được xác minh, mã dùng một lần; sai mã báo số lần còn lại', async () => {
  const { email, user } = await register();
  const code = lastCode(email);
  const err = await failure(authSvc.verifyEmail({ userId: user.id, code: wrong(code) }));
  assert.equal(err.code, 'CODE_INVALID');
  assert.equal(err.details.attemptsLeft, 4);
  assert.equal((await authSvc.verifyEmail({ userId: user.id, code })).emailVerified, true);
  assert.equal(await prisma.emailCode.count({ where: { userId: user.id } }), 0);
  assert.equal((await authSvc.verifyEmail({ userId: user.id, code: wrong(code) })).emailVerified, true); // đã xác minh: trả luôn
});

test('⭐ quá 5 lần sai thì mã đúng cũng không dùng được nữa', async () => {
  const { email, user } = await register();
  const code = lastCode(email);
  for (let i = 0; i < 5; i++) await failure(authSvc.verifyEmail({ userId: user.id, code: wrong(code) }));
  const err = await failure(authSvc.verifyEmail({ userId: user.id, code }));
  assert.equal(err.code, 'CODE_INVALID');
  assert.equal(err.details.attemptsLeft, 0);
});

test('⭐ 40 lần đoán ĐỒNG THỜI: chỉ 5 lần được so mã', async () => {
  const { email, user } = await register();
  const code = lastCode(email);
  await Promise.all(Array.from({ length: 40 }, () => codeSvc.consumeCode({ userId: user.id, purpose: 'VERIFY_EMAIL', code: wrong(code) })));
  assert.equal((await prisma.emailCode.findFirst({ where: { userId: user.id } })).attempts, 5);
});

test('⭐ cùng một mã đúng gửi đồng thời: chỉ một lần thành công', async () => {
  const { email, user } = await register();
  const code = lastCode(email);
  const results = await Promise.all(Array.from({ length: 5 }, () => codeSvc.consumeCode({ userId: user.id, purpose: 'VERIFY_EMAIL', code })));
  assert.equal(results.filter((r) => r.ok).length, 1);
});

test('mã hết hạn sau 10 phút; mã của mục đích này / người này không dùng được cho cái khác', async () => {
  const a = await register();
  const b = await register();
  const codeA = lastCode(a.email);
  const late = new Date(Date.now() + 10 * minute + 1000);
  assert.equal((await codeSvc.consumeCode({ userId: a.user.id, purpose: 'VERIFY_EMAIL', code: codeA, now: late })).ok, false);
  assert.equal((await codeSvc.consumeCode({ userId: a.user.id, purpose: 'RESET_PASSWORD', code: codeA })).ok, false);
  if (lastCode(b.email) !== codeA) assert.equal((await codeSvc.consumeCode({ userId: b.user.id, purpose: 'VERIFY_EMAIL', code: codeA })).ok, false);
  assert.equal((await codeSvc.consumeCode({ userId: a.user.id, purpose: 'VERIFY_EMAIL', code: codeA })).ok, true);
});

test('⭐ gửi lại: chờ 60 giây, tối đa 5 mã mỗi giờ, mã mới thay mã cũ', async () => {
  const { user } = await register(); // mã thứ 1
  const err = await failure(authSvc.resendVerificationCode({ userId: user.id }));
  assert.equal(err.code, 'RATE_LIMITED');
  assert.ok(err.details.retryAfterSec > 0 && err.details.retryAfterSec <= 60);
  const start = Date.now();
  const issue = (min) => codeSvc.issueCode({ userId: user.id, purpose: 'VERIFY_EMAIL', now: new Date(start + min * minute) });
  const codes = [];
  for (let i = 1; i <= 4; i++) codes.push(await issue(i * 2)); // mã thứ 2..5
  assert.ok(codes.every((c) => c.issued));
  assert.equal((await issue(20)).issued, false); // mã thứ 6 trong cùng giờ
  const next = await issue(61);
  assert.equal(next.issued, true);
  assert.equal(await prisma.emailCode.count({ where: { userId: user.id } }), 1);
});

test('⭐ nhiều yêu cầu cấp mã đồng thời: chỉ một mã được cấp', async () => {
  const user = await prisma.user.create({ data: { email: newEmail(), passwordHash: 'x', fullName: 'T' } });
  const results = await Promise.all(Array.from({ length: 8 }, () => codeSvc.issueCode({ userId: user.id, purpose: 'RESET_PASSWORD' })));
  assert.equal(results.filter((r) => r.issued).length, 1);
});

test('⭐ chưa xác minh thì không giữ được ghế (EMAIL_NOT_VERIFIED); xác minh xong thì giữ được', async () => {
  const { email, user } = await register();
  const hold = () => orderSvc.holdSeats({ userId: user.id, showtimeId: showtime.id, seatIds: [seat.id] });
  assert.equal((await failure(hold())).code, 'EMAIL_NOT_VERIFIED');
  assert.equal(await prisma.order.count({ where: { userId: user.id } }), 0);
  await authSvc.verifyEmail({ userId: user.id, code: lastCode(email) });
  assert.equal((await hold()).status, 'PENDING');
});

test('⭐ quên mật khẩu: đặt lại được, mật khẩu cũ hỏng, mọi phiên bị thu hồi, email coi như đã xác minh', async () => {
  const { email, user, refreshToken } = await register();
  await prisma.emailCode.deleteMany({ where: { userId: user.id } });
  await authSvc.requestPasswordReset({ email }).done;
  const code = lastCode(email);
  assert.match(mailsTo(email).at(-1).subject, /đặt lại mật khẩu/i);
  assert.equal((await failure(authSvc.resetPassword({ email, code: wrong(code), newPassword: 'mat-khau-moi-123' }))).code, 'CODE_INVALID');
  await authSvc.resetPassword({ email, code, newPassword: 'mat-khau-moi-123' });
  assert.equal((await failure(authSvc.login({ email, password: PASSWORD }))).code, 'INVALID_CREDENTIALS');
  assert.equal((await authSvc.login({ email, password: 'mat-khau-moi-123' })).user.emailVerified, true);
  assert.equal((await failure(authSvc.refresh({ refreshToken }))).code, 'UNAUTHORIZED');
  assert.equal((await failure(authSvc.resetPassword({ email, code, newPassword: 'mat-khau-khac-456' }))).code, 'CODE_INVALID'); // dùng một lần
});

test('⭐ quên mật khẩu không lộ email nào tồn tại: cùng phản hồi, email lạ / tài khoản khóa không nhận thư', async () => {
  const { email, user } = await register();
  await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
  const stranger = newEmail();
  const sentBefore = outbox.length;
  for (const target of [email, stranger]) {
    const res = await post('/auth/forgot-password', { email: target });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).data, { sent: true });
  }
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(outbox.length, sentBefore);
  const a = await failure(authSvc.resetPassword({ email: stranger, code: '000000', newPassword: 'mat-khau-moi-123' }));
  const b = await failure(authSvc.resetPassword({ email, code: '000000', newPassword: 'mat-khau-moi-123' }));
  assert.deepEqual([a.code, a.message, a.details], [b.code, b.message, b.details]);
});

test('HTTP: đăng ký -> verify-email; resend quá sớm 429; dữ liệu sai 400; không token 401', async () => {
  const email = newEmail();
  const reg = await (await post('/auth/register', { email, password: PASSWORD, fullName: 'Web' })).json();
  const token = reg.data.accessToken;
  assert.equal(reg.data.user.emailVerified, false);
  assert.equal((await post('/auth/verify-email', { code: '123456' })).status, 401);
  assert.equal((await post('/auth/resend-code', {})).status, 401);
  assert.equal((await post('/auth/resend-code', {}, token)).status, 429);
  for (const body of [{ code: '12345' }, { code: 'abcdef' }, {}, { code: '123456', userId: reg.data.user.id }]) {
    assert.equal((await post('/auth/verify-email', body, token)).status, 400, JSON.stringify(body));
  }
  const ok = await post('/auth/verify-email', { code: lastCode(email) }, token);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).data.emailVerified, true);
  assert.equal((await post('/auth/reset-password', { email, code: '000000', newPassword: 'ngan' })).status, 400);
  assert.equal((await post('/auth/reset-password', { email, code: '000000', newPassword: 'mat-khau-moi-123' })).status, 422);
});
