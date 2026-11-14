// DAO của hội thoại AI (chatSession / chatMessage). Mỗi hàm là MỘT thao tác truy vấn: test kiểm ĐÚNG điều kiện của từng câu,
// nhất là câu ⭐ "nhận phần" việc chờ xác nhận (cập nhật có điều kiện) và việc ghi tin + trạng thái cùng một transaction.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { prisma } = await import('../src/config/prisma.js');
const { runInTransaction } = await import('../src/dao/transaction.js');
const sessionDao = await import('../src/dao/chatSession.dao.js');
const messageDao = await import('../src/dao/chatMessage.dao.js');

const RUN = Date.now();
let user; let other;
const at = (n) => new Date(Date.UTC(2026, 10, 1, 0, 0, n));

before(async () => {
  user = await prisma.user.create({ data: { email: `test-daochat-${RUN}-a@example.com`, passwordHash: 'x', fullName: 'Test A' } });
  other = await prisma.user.create({ data: { email: `test-daochat-${RUN}-b@example.com`, passwordHash: 'x', fullName: 'Test B' } });
});
after(async () => {
  await prisma.chatSession.deleteMany({ where: { userId: { in: [user.id, other.id] } } }); // ChatMessage xóa theo (cascade)
  await prisma.user.deleteMany({ where: { id: { in: [user.id, other.id] } } });
  await prisma.$disconnect();
});

test('chatSession DAO: insertSession (ACTIVE, state rỗng) / getSessionById (null khi không có) / updateSessionState (giữ lastActiveAt nếu không truyền) / markSessionClosed', async () => {
  const s = await sessionDao.insertSession(user.id);
  assert.deepEqual([s.userId, s.status, s.state], [user.id, 'ACTIVE', {}]);
  assert.equal((await sessionDao.getSessionById(s.id)).id, s.id);
  assert.equal(await sessionDao.getSessionById('00000000-0000-4000-8000-000000000000'), null);

  const stamp = at(5);
  await sessionDao.updateSessionState({ sessionId: s.id, state: { pendingAction: { actionId: 'a' } }, lastActiveAt: stamp });
  let row = await sessionDao.getSessionById(s.id);
  assert.deepEqual([row.state, row.lastActiveAt.getTime()], [{ pendingAction: { actionId: 'a' } }, stamp.getTime()]);
  await sessionDao.updateSessionState({ sessionId: s.id, state: { pendingAction: null } }); // không truyền lastActiveAt
  row = await sessionDao.getSessionById(s.id);
  assert.deepEqual([row.state, row.lastActiveAt.getTime()], [{ pendingAction: null }, stamp.getTime()]);

  await sessionDao.markSessionClosed({ sessionId: s.id, state: { closed: true } });
  row = await sessionDao.getSessionById(s.id);
  assert.deepEqual([row.status, row.state], ['CLOSED', { closed: true }]);
});

test('⭐ claimPendingAction: 10 lần SONG SONG chỉ 1 lần nhận phần (count = 1), 9 lần count = 0; sai lastActiveAt đã đọc -> 0 và KHÔNG ghi đè', async () => {
  const s = await sessionDao.insertSession(user.id);
  const expected = s.lastActiveAt;
  const counts = await Promise.all(Array.from({ length: 10 }, (_, i) => sessionDao.claimPendingAction({
    sessionId: s.id, expectedLastActiveAt: expected, state: { winner: i }, lastActiveAt: new Date(expected.getTime() + 1000),
  })));
  assert.equal(counts.filter((c) => c === 1).length, 1);
  assert.equal(counts.filter((c) => c === 0).length, 9);
  const row = await sessionDao.getSessionById(s.id);
  assert.equal(row.lastActiveAt.getTime(), expected.getTime() + 1000);
  const winner = row.state.winner;
  // request đến sau với giá trị cũ: bị từ chối, trạng thái giữ nguyên
  assert.equal(await sessionDao.claimPendingAction({ sessionId: s.id, expectedLastActiveAt: expected, state: { winner: 'trễ' }, lastActiveAt: new Date() }), 0);
  assert.equal((await sessionDao.getSessionById(s.id)).state.winner, winner);
  // đúng giá trị hiện tại thì nhận được (mỗi lần nhận đẩy lastActiveAt đi tiếp)
  assert.equal(await sessionDao.claimPendingAction({ sessionId: s.id, expectedLastActiveAt: row.lastActiveAt, state: { winner: 'tiếp' }, lastActiveAt: new Date(row.lastActiveAt.getTime() + 1) }), 1);
  assert.equal(await sessionDao.claimPendingAction({ sessionId: '00000000-0000-4000-8000-000000000000', expectedLastActiveAt: expected, state: {}, lastActiveAt: expected }), 0);
});

test('chatMessage DAO: insertMessages / insertMessage ghi đúng; getRecentMessages lấy `take` tin MỚI NHẤT (mới -> cũ) của ĐÚNG phiên; getLastMessage; listVisibleMessages ẩn lượt gọi tool', async () => {
  const s = await sessionDao.insertSession(user.id);
  const s2 = await sessionDao.insertSession(other.id);
  assert.equal(await messageDao.getLastMessage(s.id), null);
  assert.deepEqual(await messageDao.getRecentMessages({ sessionId: s.id, take: 5 }), []);

  await messageDao.insertMessages([
    { sessionId: s.id, role: 'USER', content: 'm1', createdAt: at(1) },
    { sessionId: s.id, role: 'ASSISTANT', content: '', toolName: 'list_combos', toolInput: { calls: [] }, createdAt: at(2) },
    { sessionId: s.id, role: 'TOOL', content: '[]', toolName: 'list_combos', toolInput: { callId: 'c1' }, toolOutput: [], createdAt: at(3) },
    { sessionId: s.id, role: 'ASSISTANT', content: 'm4', createdAt: at(4) },
  ]);
  await messageDao.insertMessage({ sessionId: s2.id, role: 'USER', content: 'của người khác', createdAt: at(9) });
  await messageDao.insertMessage({ sessionId: s.id, role: 'USER', content: 'm5', createdAt: at(5) });

  const recent = await messageDao.getRecentMessages({ sessionId: s.id, take: 3 });
  assert.deepEqual(recent.map((m) => m.content), ['m5', 'm4', '[]']); // mới -> cũ, đúng 3 tin, không lẫn phiên khác
  assert.equal((await messageDao.getLastMessage(s.id)).createdAt.getTime(), at(5).getTime());
  assert.deepEqual((await messageDao.listVisibleMessages(s.id)).map((m) => [m.role, m.content]), [['USER', 'm1'], ['ASSISTANT', ''], ['ASSISTANT', 'm4'], ['USER', 'm5']]);
  assert.ok((await messageDao.listVisibleMessages(s.id)).every((m) => m.role !== 'TOOL'));
  assert.deepEqual((await messageDao.listVisibleMessages(s2.id)).map((m) => m.content), ['của người khác']);
});

test('⭐ cùng tx: ghi tin + cập nhật trạng thái phiên là MỘT transaction — lỗi giữa chừng thì cả hai cùng bị ROLLBACK', async () => {
  const s = await sessionDao.insertSession(user.id);
  await assert.rejects(() => runInTransaction(async (tx) => {
    await messageDao.insertMessages([{ sessionId: s.id, role: 'USER', content: 'sẽ bị hủy', createdAt: at(1) }], tx);
    await sessionDao.updateSessionState({ sessionId: s.id, state: { pendingAction: { actionId: 'x' } } }, tx);
    assert.equal((await messageDao.getRecentMessages({ sessionId: s.id, take: 5 })).length, 0, 'ngoài transaction chưa thấy tin');
    throw new Error('lỗi giữa chừng');
  }), /lỗi giữa chừng/);
  assert.equal((await messageDao.getRecentMessages({ sessionId: s.id, take: 5 })).length, 0);
  assert.deepEqual((await sessionDao.getSessionById(s.id)).state, {});
});

test('xóa phiên kéo theo xóa tin (cascade): không để lại tin mồ côi', async () => {
  const s = await sessionDao.insertSession(other.id);
  await messageDao.insertMessage({ sessionId: s.id, role: 'USER', content: 'x', createdAt: at(1) });
  await prisma.chatSession.delete({ where: { id: s.id } });
  assert.equal(await prisma.chatMessage.count({ where: { sessionId: s.id } }), 0);
});
