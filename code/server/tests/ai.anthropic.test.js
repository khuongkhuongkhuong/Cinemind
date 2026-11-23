// Bộ chuyển Anthropic (ai/llm/anthropic.js): dùng client GIẢ nên không tốn token và không cần khóa API.
// Kiểm: dịch tin nhắn / công cụ qua lại đúng, tham số gửi đi đúng với mô hình Opus 5.5 (không có tham số bị API từ chối),
// xử lý từ chối / cắt cụt, và chạy thử trọn vòng với Agent + chat service thật.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { prisma } = await import('../src/config/prisma.js');
const { createAnthropicLlm, toAnthropicMessages, toAnthropicTools, DEFAULT_MODEL, REFUSAL_TEXT } = await import('../src/ai/llm/anthropic.js');
const { setLlm } = await import('../src/ai/llm/index.js');
const chatSvc = await import('../src/services/chat.service.js');
const { parseEnv } = await import('../src/config/env.js');

const RUN = Date.now();
const TOOL = { name: 'list_combos', description: 'Danh sách combo', inputSchema: { type: 'object', properties: {}, additionalProperties: false } };

/** Client giả: ghi lại mọi yêu cầu; `replies` là các phản hồi lần lượt (hoặc Error để ném). */
function fakeClient(replies) {
  const calls = { beta: [], plain: [] };
  let i = 0;
  const next = (bucket) => async (params) => {
    calls[bucket].push(structuredClone(params));
    const r = replies[i++];
    if (r instanceof Error) throw r;
    return r;
  };
  return { calls, beta: { messages: { create: next('beta') } }, messages: { create: next('plain') } };
}
const reply = (content, extra = {}) => ({ content, stop_reason: 'end_turn', usage: { input_tokens: 120, output_tokens: 30 }, ...extra });

test('toAnthropicMessages: tin khách / trả lời thường giữ nguyên', () => {
  assert.deepEqual(toAnthropicMessages([{ role: 'user', content: 'chào' }, { role: 'assistant', content: 'xin chào' }]),
    [{ role: 'user', content: 'chào' }, { role: 'assistant', content: 'xin chào' }]);
});

test('toAnthropicMessages: assistant có toolCalls -> khối text + tool_use; kết quả công cụ LIỀN NHAU gộp vào MỘT tin user (gọi song song)', () => {
  const out = toAnthropicMessages([
    { role: 'user', content: 'combo và suất?' },
    { role: 'assistant', content: 'để mình tra', toolCalls: [{ id: 'c1', name: 'list_combos', input: {} }, { id: 'c2', name: 'find_showtimes', input: { date: '2026-12-01' } }] },
    { role: 'tool', toolCallId: 'c1', name: 'list_combos', content: '[1]' },
    { role: 'tool', toolCallId: 'c2', name: 'find_showtimes', content: '[2]' },
    { role: 'assistant', content: 'xong' },
  ]);
  assert.equal(out.length, 4); // user, assistant(tool_use), user(2 tool_result), assistant
  assert.deepEqual(out[1].content, [
    { type: 'text', text: 'để mình tra' },
    { type: 'tool_use', id: 'c1', name: 'list_combos', input: {} },
    { type: 'tool_use', id: 'c2', name: 'find_showtimes', input: { date: '2026-12-01' } },
  ]);
  assert.deepEqual(out[2], { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'c1', content: '[1]' },
    { type: 'tool_result', tool_use_id: 'c2', content: '[2]' },
  ] });
});

test('toAnthropicMessages: assistant không có chữ chỉ có tool_use (không sinh khối text rỗng); vai trò lạ bị từ chối', () => {
  const [m] = toAnthropicMessages([{ role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'x', input: {} }] }]);
  assert.deepEqual(m.content.map((b) => b.type), ['tool_use']);
  assert.throws(() => toAnthropicMessages([{ role: 'system', content: 'x' }]), /Vai trò/);
});

test('toAnthropicTools: inputSchema -> input_schema', () => {
  assert.deepEqual(toAnthropicTools([TOOL]), [{ name: 'list_combos', description: 'Danh sách combo', input_schema: TOOL.inputSchema }]);
});

test('⭐ tham số gửi đi (mô hình mặc định Sonnet 5.5): đúng model, effort, system, tools, fallback; KHÔNG có thinking / temperature / tool_choice ép buộc (API từ chối)', async () => {
  const client = fakeClient([reply([{ type: 'text', text: 'ok' }])]);
  const llm = createAnthropicLlm({ client });
  await llm.complete({ system: 'SYS', messages: [{ role: 'user', content: 'hi' }], tools: [TOOL], maxTokens: 1234 });
  assert.equal(client.calls.beta.length, 1);
  const p = client.calls.beta[0];
  assert.equal(p.model, DEFAULT_MODEL);
  assert.equal(DEFAULT_MODEL, 'claude-sonnet-5-5'); // quyết định D1 trong docs/07
  assert.deepEqual([p.max_tokens, p.system], [1234, 'SYS']);
  assert.deepEqual(p.output_config, { effort: 'low' });
  assert.deepEqual([p.betas, p.fallbacks], [['server-side-fallback-2026-07-01'], 'default']);
  assert.equal(p.tools[0].input_schema.type, 'object');
  for (const banned of ['thinking', 'temperature', 'top_p', 'top_k', 'tool_choice']) assert.equal(banned in p, false, banned);
});

test('tắt fallback / đổi model + effort: dùng endpoint thường, không có betas / fallbacks', async () => {
  const client = fakeClient([reply([{ type: 'text', text: 'ok' }])]);
  await createAnthropicLlm({ client, model: 'claude-opus-5-5', effort: 'medium', refusalFallback: false })
    .complete({ system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [], maxTokens: 100 });
  assert.equal(client.calls.beta.length, 0);
  const p = client.calls.plain[0];
  assert.deepEqual([p.model, p.output_config.effort], ['claude-opus-5-5', 'medium']);
  assert.equal('betas' in p || 'fallbacks' in p, false);
});

test('phân tích phản hồi: gộp text, lấy tool_use, BỎ QUA khối thinking / fallback; usage được ghi lại', async () => {
  const client = fakeClient([reply([
    { type: 'thinking', thinking: '' },
    { type: 'text', text: 'Để mình ' },
    { type: 'text', text: 'tra nhé.' },
    { type: 'fallback', from: { model: 'a' }, to: { model: 'b' } },
    { type: 'tool_use', id: 'toolu_1', name: 'list_combos', input: { a: 1 } },
  ], { stop_reason: 'tool_use', usage: { input_tokens: 200, output_tokens: 50, cache_read_input_tokens: 80 } })]);
  const out = await createAnthropicLlm({ client }).complete({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: [TOOL], maxTokens: 100 });
  assert.equal(out.text, 'Để mình tra nhé.');
  assert.deepEqual(out.toolCalls, [{ id: 'toolu_1', name: 'list_combos', input: { a: 1 } }]);
  assert.deepEqual(out.usage, { inputTokens: 200, outputTokens: 50, cacheReadTokens: 80 });
});

test('⭐ bộ lọc an toàn từ chối (stop_reason = refusal): trả lời lịch sự, không có lời gọi công cụ, không ném lỗi', async () => {
  const client = fakeClient([reply([{ type: 'text', text: 'nội dung bị từ chối' }, { type: 'tool_use', id: 't', name: 'list_combos', input: {} }], { stop_reason: 'refusal' })]);
  const out = await createAnthropicLlm({ client }).complete({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: [TOOL], maxTokens: 100 });
  assert.deepEqual([out.text, out.toolCalls], [REFUSAL_TEXT, []]);
});

test('⭐ bị cắt cụt (max_tokens) giữa lúc viết lời gọi công cụ: KHÔNG chạy tham số dở dang (ném lỗi); cắt cụt khi chỉ có chữ thì vẫn trả chữ', async () => {
  const cut = fakeClient([reply([{ type: 'tool_use', id: 't', name: 'list_combos', input: {} }], { stop_reason: 'max_tokens' })]);
  await assert.rejects(() => createAnthropicLlm({ client: cut }).complete({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: [TOOL], maxTokens: 10 }), /LLM_TRUNCATED_TOOL_CALL/);
  const textOnly = fakeClient([reply([{ type: 'text', text: 'dở dang' }], { stop_reason: 'max_tokens' })]);
  assert.equal((await createAnthropicLlm({ client: textOnly }).complete({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: [], maxTokens: 10 })).text, 'dở dang');
});

test('lỗi từ API được ném tiếp (lớp chat.service dịch thành AI_UNAVAILABLE)', async () => {
  const client = fakeClient([Object.assign(new Error('401 invalid x-api-key'), { status: 401 })]);
  await assert.rejects(() => createAnthropicLlm({ client }).complete({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: [], maxTokens: 10 }), /401/);
});

// ------------------------------------------------------------------ chạy thử trọn vòng: adapter + Agent + chat service thật ------------------------------------------------------------------
let user;
before(async () => { user = await prisma.user.create({ data: { email: `test-aianth-${RUN}@example.com`, passwordHash: 'x', fullName: 'Test' } }); });
after(async () => {
  setLlm(null);
  await prisma.chatSession.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.$disconnect();
});

test('⭐ trọn vòng: khách hỏi -> mô hình gọi list_combos -> Agent chạy công cụ thật -> kết quả quay lại đúng id -> câu trả lời cuối lưu vào phiên', async () => {
  const client = fakeClient([
    reply([{ type: 'text', text: 'Để mình xem.' }, { type: 'tool_use', id: 'toolu_A', name: 'list_combos', input: {} }], { stop_reason: 'tool_use' }),
    reply([{ type: 'text', text: 'Có các combo bắp nước nhé.' }]),
  ]);
  setLlm(createAnthropicLlm({ client }));
  const { sessionId, reply: r } = await chatSvc.chat({ userId: user.id, text: 'Có combo gì không?' });
  assert.equal(r.text, 'Có các combo bắp nước nhé.');
  assert.equal(r.pendingAction, null);

  assert.equal(client.calls.beta.length, 2);
  const second = client.calls.beta[1].messages;
  const last = second.at(-1);
  assert.equal(last.role, 'user');
  assert.equal(last.content[0].type, 'tool_result');
  assert.equal(last.content[0].tool_use_id, 'toolu_A'); // đúng id của lời gọi
  assert.ok(JSON.parse(last.content[0].content)); // kết quả công cụ là JSON hợp lệ do server tạo
  assert.deepEqual(second.at(-2).content.map((b) => b.type), ['text', 'tool_use']);
  assert.ok((await chatSvc.getSession({ userId: user.id, sessionId })).messages.some((m) => m.text === 'Có các combo bắp nước nhé.'));
});

test('lỗi API giữa chừng: khách nhận AI_UNAVAILABLE, không lộ chi tiết (khóa, thông điệp gốc)', async () => {
  setLlm(createAnthropicLlm({ client: fakeClient([Object.assign(new Error('401 invalid x-api-key sk-ant-SECRET'), { status: 401 })]) }));
  const err = await chatSvc.chat({ userId: user.id, text: 'chào' }).then(() => null, (e) => e);
  assert.equal(err.code, 'AI_UNAVAILABLE');
  assert.ok(!JSON.stringify(err.message).includes('SECRET'));
});

// ------------------------------------------------------------------ cấu hình ------------------------------------------------------------------
const BASE_ENV = { DATABASE_URL: 'postgresql://x', JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32) };

test('cấu hình: không có ANTHROPIC_API_KEY vẫn hợp lệ (trợ lý tắt); mặc định claude-sonnet-5-5, effort low, fallback bật, trần toàn hệ thống 2000 tin / ngày', () => {
  const r = parseEnv(BASE_ENV);
  assert.equal(r.success, true);
  assert.deepEqual([r.data.ANTHROPIC_API_KEY, r.data.AI_MODEL, r.data.AI_EFFORT, r.data.AI_REFUSAL_FALLBACK, r.data.AI_GLOBAL_DAILY_LIMIT], [undefined, 'claude-sonnet-5-5', 'low', true, 2000]);
});

test('cấu hình: đổi được model / effort / tắt fallback; effort sai hoặc khóa rỗng bị từ chối', () => {
  const ok = parseEnv({ ...BASE_ENV, ANTHROPIC_API_KEY: 'k', AI_MODEL: 'claude-opus-5-5', AI_EFFORT: 'high', AI_REFUSAL_FALLBACK: 'false', AI_GLOBAL_DAILY_LIMIT: '0' });
  assert.deepEqual([ok.data.AI_MODEL, ok.data.AI_EFFORT, ok.data.AI_REFUSAL_FALLBACK, ok.data.AI_GLOBAL_DAILY_LIMIT], ['claude-opus-5-5', 'high', false, 0]);
  assert.equal(parseEnv({ ...BASE_ENV, AI_EFFORT: 'extreme' }).success, false);
  assert.equal(parseEnv({ ...BASE_ENV, ANTHROPIC_API_KEY: '' }).success, false);
  assert.equal(parseEnv({ ...BASE_ENV, AI_GLOBAL_DAILY_LIMIT: '-1' }).success, false);
});
