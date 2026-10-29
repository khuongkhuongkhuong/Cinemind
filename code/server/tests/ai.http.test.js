// Endpoint trợ lý AI qua HTTP (docs/04 mục 2.8, 3.9): xác thực, phân quyền, validation, luồng đặt vé đầy đủ.
// Dùng MÔ HÌNH GIẢ. Cần dữ liệu mẫu: chạy `npm run db:seed` trước.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { prisma } = await import('../src/config/prisma.js');
const showtimeSvc = await import('../src/services/showtime.service.js');
const chatSvc = await import('../src/services/chat.service.js');
const { default: app } = await import('../src/app.js');
const { signAccessToken } = await import('../src/lib/jwt.js');
const { createFakeLlm } = await import('../src/ai/llm/fake.js');
const { setLlm } = await import('../src/ai/llm/index.js');

const minute = 60_000;
const DAY = 24 * 60 * minute;
const RUN = Date.now();
const T = (name, input = {}) => ({ name, input });
let room; let showtime; let alice; let bob; let staff; let server; let base; let seatsByLabel;
const seatId = (l) => seatsByLabel[l].id;
const tokenOf = (user) => signAccessToken({ id: user.id, role: user.role });

/** Gọi API với token của `user` (null = không token). */
async function api(method, path, { user = null, body, headers = {}, raw } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(user && { Authorization: `Bearer ${tokenOf(user)}` }), ...((body !== undefined || raw) && { 'Content-Type': 'application/json' }), ...headers },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const json = await res.json();
  return { status: res.status, json, data: json.data, error: json.error };
}
const useLlm = (script) => { const fake = createFakeLlm(script); setLlm(fake); return fake; };
const holdScript = (labels) => [{ toolCalls: [T('hold_seats', { showtimeId: showtime.id, seatIds: labels.map(seatId) })] }, { text: 'Bạn xác nhận nhé.' }];

async function clean() {
  const users = [alice.id, bob.id, staff.id];
  await prisma.chatSession.deleteMany({ where: { userId: { in: users } } });
  await prisma.payment.deleteMany({ where: { order: { userId: { in: users } } } });
  await prisma.order.deleteMany({ where: { userId: { in: users } } });
}

before(async () => {
  // Rạp DỮ LIỆU MẪU, không phải rạp tạm do test khác tạo ra song song rồi xóa.
  const cinema = await prisma.cinema.findFirst({ where: { name: { startsWith: 'Cinemind' }, isActive: true }, orderBy: { name: 'asc' } });
  room = await prisma.room.create({ data: { cinemaId: cinema.id, name: `TestRoom-${RUN}-aihttp` } });
  const data = [];
  for (let n = 1; n <= 10; n++) data.push({ roomId: room.id, row: 'A', number: n, type: 'STANDARD' });
  for (let n = 1; n <= 10; n++) data.push({ roomId: room.id, row: 'B', number: n, type: 'VIP' });
  await prisma.seat.createMany({ data });
  seatsByLabel = Object.fromEntries((await prisma.seat.findMany({ where: { roomId: room.id } })).map((s) => [`${s.row}${s.number}`, s]));
  const movie = await prisma.movie.findFirst({ where: { status: 'NOW_SHOWING' } });
  const start = new Date(Math.ceil((Date.now() + 62 * DAY) / (60 * minute)) * 60 * minute);
  showtime = await showtimeSvc.createShowtime({ movieId: movie.id, roomId: room.id, startTime: start, format: 'F2D', audio: 'SUBTITLE', basePrice: 80_000 });
  const mk = (tag, role = 'USER') => prisma.user.create({ data: { email: `test-aihttp-${RUN}-${tag}@example.com`, passwordHash: 'x', fullName: `Test ${tag}`, role } });
  [alice, bob, staff] = [await mk('a'), await mk('b'), await mk('s', 'STAFF')];
  server = app.listen(0);
  base = `http://localhost:${server.address().port}/api/v1`;
});
beforeEach(async () => {
  chatSvc.resetChatRateLimits();
  setLlm(null);
  await prisma.user.update({ where: { id: alice.id }, data: { isActive: true } });
  await clean();
});
after(async () => {
  server.close();
  setLlm(null);
  await clean();
  await prisma.showtime.deleteMany({ where: { roomId: room.id } });
  await prisma.seat.deleteMany({ where: { roomId: room.id } });
  await prisma.room.delete({ where: { id: room.id } });
  await prisma.user.deleteMany({ where: { id: { in: [alice.id, bob.id, staff.id] } } });
  await prisma.$disconnect();
});

const ENDPOINTS = (sid = '00000000-0000-4000-8000-000000000000') => [
  ['POST', '/ai/chat', { text: 'xin chào' }],
  ['POST', '/ai/confirm', { sessionId: sid, actionId: sid, approve: true }],
  ['GET', `/ai/sessions/${sid}`],
  ['DELETE', `/ai/sessions/${sid}`],
];

test('⭐ xác thực: không token / token hỏng / token hết hạn -> 401 ở cả 4 endpoint, LLM không bị gọi', async () => {
  const fake = useLlm([{ text: 'ok' }]);
  for (const [method, path, body] of ENDPOINTS()) {
    assert.equal((await api(method, path, { body })).status, 401, `${method} ${path}`);
    const bad = await fetch(base + path, { method, headers: { Authorization: 'Bearer abc.def.ghi', 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    assert.equal(bad.status, 401, `${method} ${path} token hỏng`);
  }
  assert.equal(fake.calls.length, 0);
});

test('⭐ tài khoản bị khóa không chat được NGAY (trạng thái đọc lại từ DB mỗi request, dù access token còn hạn); mọi vai trò đã đăng nhập đều dùng được', async () => {
  useLlm([{ text: 'chào' }, { text: 'chào' }, { text: 'chào' }]);
  assert.equal((await api('POST', '/ai/chat', { user: alice, body: { text: 'hi' } })).status, 200);
  assert.equal((await api('POST', '/ai/chat', { user: staff, body: { text: 'hi' } })).status, 200);
  await prisma.user.update({ where: { id: alice.id }, data: { isActive: false } });
  const locked = await api('POST', '/ai/chat', { user: alice, body: { text: 'hi' } });
  assert.equal(locked.status, 403);
  assert.equal(locked.error.code, 'ACCOUNT_DISABLED');
});

test('đúng hình dạng phản hồi: { success, data: { sessionId, reply: { text, pendingAction } } }; pendingAction không lộ `input`', async () => {
  useLlm([...holdScript(['A1', 'A2'])]);
  const res = await api('POST', '/ai/chat', { user: alice, body: { text: 'giữ A1 A2 giúp mình' } });
  assert.equal(res.status, 200);
  assert.equal(res.json.success, true);
  assert.match(res.data.sessionId, /^[0-9a-f-]{36}$/);
  assert.equal(typeof res.data.reply.text, 'string');
  assert.deepEqual(Object.keys(res.data.reply.pendingAction).sort(), ['actionId', 'expiresAt', 'summary', 'tool']);
  assert.match(res.data.reply.pendingAction.summary, /Giữ ghế A1, A2/);
});

test('⭐ luồng đặt vé trọn vẹn qua HTTP: chat -> hộp xác nhận -> xác nhận -> đơn AI_CHAT thật -> nạp lại phiên -> đóng phiên', async () => {
  useLlm([...holdScript(['B1', 'B2']), { text: 'Bạn cần gì thêm?' }]);
  const chat = await api('POST', '/ai/chat', { user: alice, body: { text: 'đặt B1 B2' } });
  const { sessionId, reply } = chat.data;
  assert.equal(await prisma.order.count({ where: { userId: alice.id } }), 0); // chưa xác nhận: chưa có gì

  const done = await api('POST', '/ai/confirm', { user: alice, body: { sessionId, actionId: reply.pendingAction.actionId, approve: true } });
  assert.equal(done.status, 200);
  assert.equal(done.data.reply.order.total, 190_000);
  assert.match(done.data.reply.text, /Đã giữ ghế B1, B2/);
  const order = await prisma.order.findFirst({ where: { userId: alice.id } });
  assert.equal(order.source, 'AI_CHAT');
  assert.equal(order.id, done.data.reply.order.id);

  const shown = await api('GET', `/ai/sessions/${sessionId}`, { user: alice });
  assert.equal(shown.status, 200);
  assert.equal(shown.data.status, 'ACTIVE');
  assert.equal(shown.data.pendingAction, null);
  assert.deepEqual(shown.data.messages.map((m) => m.role), ['USER', 'ASSISTANT', 'ASSISTANT']);

  const closed = await api('DELETE', `/ai/sessions/${sessionId}`, { user: alice });
  assert.deepEqual(closed.data, { sessionId, status: 'CLOSED' });
  assert.equal((await api('POST', '/ai/chat', { user: alice, body: { sessionId, text: 'còn đó không' } })).status, 404);
  assert.equal((await api('GET', `/ai/sessions/${sessionId}`, { user: alice })).status, 404);
});

test('⭐ phiên của người khác: đọc / chat / xác nhận / đóng đều 403, không có gì bị thực thi', async () => {
  useLlm([...holdScript(['A3']), { text: 'ok' }]);
  const { sessionId, reply } = (await api('POST', '/ai/chat', { user: alice, body: { text: 'giữ A3' } })).data;
  assert.equal((await api('GET', `/ai/sessions/${sessionId}`, { user: bob })).status, 403);
  assert.equal((await api('POST', '/ai/chat', { user: bob, body: { sessionId, text: 'chen ngang' } })).status, 403);
  assert.equal((await api('POST', '/ai/confirm', { user: bob, body: { sessionId, actionId: reply.pendingAction.actionId, approve: true } })).status, 403);
  assert.equal((await api('DELETE', `/ai/sessions/${sessionId}`, { user: bob })).status, 403);
  assert.equal(await prisma.order.count({ where: { userId: { in: [alice.id, bob.id] } } }), 0);
  // chính chủ vẫn xác nhận được
  assert.equal((await api('POST', '/ai/confirm', { user: alice, body: { sessionId, actionId: reply.pendingAction.actionId, approve: true } })).status, 200);
});

test('⭐ danh tính chỉ từ token: body chứa userId / role / trường lạ bị từ chối 400 (mass assignment), LLM không bị gọi', async () => {
  const fake = useLlm([{ text: 'ok' }]);
  for (const extra of [{ userId: bob.id }, { role: 'ADMIN' }, { source: 'AI_CHAT' }]) {
    const res = await api('POST', '/ai/chat', { user: alice, body: { text: 'hi', ...extra } });
    assert.equal(res.status, 400, JSON.stringify(extra));
    assert.equal(res.error.code, 'VALIDATION_ERROR');
  }
  const confirmExtra = await api('POST', '/ai/confirm', { user: alice, body: { sessionId: bob.id, actionId: bob.id, approve: true, userId: bob.id } });
  assert.equal(confirmExtra.status, 400);
  assert.equal(fake.calls.length, 0);
});

test('validation: thiếu / sai kiểu / quá dài -> 400 kèm lỗi theo ô; sessionId, actionId, id sai định dạng -> 400', async () => {
  const fake = useLlm([{ text: 'ok' }]);
  const cases = [
    ['/ai/chat', {}, 'text'], ['/ai/chat', { text: 123 }, 'text'], ['/ai/chat', { text: 'x'.repeat(1001) }, 'text'],
    ['/ai/chat', { text: 'hi', sessionId: 'abc' }, 'sessionId'],
    ['/ai/confirm', { sessionId: 'abc', actionId: 'abc', approve: true }, 'sessionId'],
    ['/ai/confirm', { sessionId: alice.id, actionId: alice.id, approve: 'yes' }, 'approve'],
    ['/ai/confirm', { sessionId: alice.id, approve: true }, 'actionId'],
  ];
  for (const [path, body, field] of cases) {
    const res = await api('POST', path, { user: alice, body });
    assert.equal(res.status, 400, `${path} ${JSON.stringify(body).slice(0, 40)}`);
    assert.ok(res.error.details?.fields?.[field], `thiếu lỗi cho ô ${field}`);
  }
  assert.equal((await api('GET', '/ai/sessions/khong-phai-uuid', { user: alice })).status, 400);
  assert.equal((await api('DELETE', '/ai/sessions/123', { user: alice })).status, 400);
  assert.equal((await api('POST', '/ai/chat', { user: alice, body: { text: 'x'.repeat(1000) } })).status, 200); // đúng 1000 thì được
  assert.equal((await api('POST', '/ai/chat', { user: alice, body: { text: '   ' } })).status, 400); // chỉ khoảng trắng (service chặn)
  assert.equal(fake.calls.length, 1);
});

test('body quá lớn -> 413 và JSON hỏng -> 400, không đến được LLM', async () => {
  const fake = useLlm([{ text: 'ok' }]);
  assert.equal((await api('POST', '/ai/chat', { user: alice, body: { text: 'x'.repeat(200_000) } })).status, 413);
  assert.equal((await api('POST', '/ai/chat', { user: alice, raw: '{"text": "hi"' })).status, 400);
  assert.equal(fake.calls.length, 0);
});

test('⭐ giới hạn: tin thứ 21 trong một phút -> 429 RATE_LIMITED (mã lỗi đúng hợp đồng); tài khoản khác vẫn dùng được', async () => {
  useLlm(Array.from({ length: 40 }, () => ({ text: 'ok' })));
  for (let i = 0; i < chatSvc.RATE_PER_MINUTE; i++) assert.equal((await api('POST', '/ai/chat', { user: alice, body: { text: `tin ${i}` } })).status, 200);
  const blocked = await api('POST', '/ai/chat', { user: alice, body: { text: 'tin 21' } });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.error.code, 'RATE_LIMITED');
  assert.equal((await api('POST', '/ai/chat', { user: bob, body: { text: 'tôi là người khác' } })).status, 200);
});

test('⭐ chưa cấu hình LLM / LLM lỗi -> 503 AI_UNAVAILABLE, không lộ chi tiết kỹ thuật (kể cả chuỗi giống khóa API)', async () => {
  setLlm(null);
  const none = await api('POST', '/ai/chat', { user: alice, body: { text: 'hi' } });
  assert.equal(none.status, 503);
  assert.equal(none.error.code, 'AI_UNAVAILABLE');

  useLlm([new Error('401 invalid x-api-key sk-ant-api03-SECRET at https://api.anthropic.com')]);
  const broken = await api('POST', '/ai/chat', { user: alice, body: { text: 'hi' } });
  assert.equal(broken.status, 503);
  assert.equal(broken.error.code, 'AI_UNAVAILABLE');
  assert.ok(!JSON.stringify(broken.json).includes('SECRET'));
  assert.ok(!JSON.stringify(broken.json).includes('anthropic'));
});

test('xác nhận qua HTTP: bấm lần hai cùng actionId -> 404; từ chối (approve=false) không tạo đơn; actionId lạ -> 404', async () => {
  useLlm([...holdScript(['A4']), ...holdScript(['A5'])]);
  const a = (await api('POST', '/ai/chat', { user: alice, body: { text: 'giữ A4' } })).data;
  const ok = { sessionId: a.sessionId, actionId: a.reply.pendingAction.actionId, approve: true };
  assert.equal((await api('POST', '/ai/confirm', { user: alice, body: ok })).status, 200);
  const again = await api('POST', '/ai/confirm', { user: alice, body: ok });
  assert.equal(again.status, 404);
  assert.equal(again.error.code, 'NOT_FOUND');
  assert.equal(await prisma.order.count({ where: { userId: alice.id } }), 1);

  const b = (await api('POST', '/ai/chat', { user: alice, body: { sessionId: a.sessionId, text: 'giữ thêm A5' } })).data;
  const declined = await api('POST', '/ai/confirm', { user: alice, body: { sessionId: a.sessionId, actionId: b.reply.pendingAction.actionId, approve: false } });
  assert.equal(declined.status, 200);
  assert.match(declined.data.reply.text, /đã hủy/i);
  assert.equal(await prisma.order.count({ where: { userId: alice.id } }), 1);
  const unknown = await api('POST', '/ai/confirm', { user: alice, body: { sessionId: a.sessionId, actionId: '00000000-0000-4000-8000-000000000000', approve: true } });
  assert.equal(unknown.status, 404);
});

test('thất bại nghiệp vụ khi xác nhận (ghế vừa bị lấy) là 200 kèm lời giải thích trong reply, không phải lỗi HTTP', async () => {
  useLlm([...holdScript(['A6'])]);
  const a = (await api('POST', '/ai/chat', { user: alice, body: { text: 'giữ A6' } })).data;
  // Bob giữ A6 trước qua đường web thường
  const hold = await api('POST', '/orders', { user: bob, body: { showtimeId: showtime.id, seatIds: [seatId('A6')] } });
  assert.equal(hold.status, 201);
  const res = await api('POST', '/ai/confirm', { user: alice, body: { sessionId: a.sessionId, actionId: a.reply.pendingAction.actionId, approve: true } });
  assert.equal(res.status, 200);
  assert.match(res.data.reply.text, /A6/);
  assert.equal(res.data.reply.order, undefined);
});

test('nhật ký thao tác (AuditLog) không ghi hội thoại AI: các endpoint /ai không nằm dưới /admin và không lưu nội dung chat vào nhật ký', async () => {
  useLlm([{ text: 'ok' }]);
  const before = await prisma.auditLog.count({ where: { actorId: alice.id } });
  await api('POST', '/ai/chat', { user: alice, body: { text: 'bí mật của tôi: 123456' } });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await prisma.auditLog.count({ where: { actorId: alice.id } }), before);
});
