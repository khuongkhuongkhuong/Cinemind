import { randomUUID } from 'node:crypto';
import { AppError } from '../utils/AppError.js';
import { getTool, toolSpecs } from './tools.js';

export const MAX_STEPS = 6; // số vòng gọi LLM tối đa cho MỘT tin nhắn của khách (chống vòng lặp vô hạn / tốn tiền)
export const PENDING_TTL_MS = 5 * 60_000; // việc chờ xác nhận hết hạn sau 5 phút
const MAX_OUTPUT_CHARS = 8000; // cắt kết quả tool quá dài trước khi đưa cho LLM
const MAX_TOKENS = 1024;

const FALLBACK_TEXT = 'Mình cần thêm thông tin để giúp bạn. Bạn cho mình biết rõ hơn bạn muốn xem phim nào, ngày nào và mấy người nhé?';

/** Lỗi -> dạng đưa cho LLM: { error: { code, message, details? } }. Lỗi hạ tầng (không phải AppError) không lộ chi tiết. */
function toToolError(err) {
  if (err instanceof AppError) return { error: { code: err.code, message: err.message, ...(err.details && { details: err.details }) } };
  console.error('[ai] lỗi không lường trước trong tool:', err);
  return { error: { code: 'INTERNAL_ERROR', message: 'Có lỗi hệ thống khi thực hiện thao tác này.' } };
}

/** Rút gọn lỗi zod thành thông báo ngắn cho LLM tự sửa tham số. */
function zodMessage(error) {
  return error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
}

/**
 * Xử lý MỘT lần gọi tool của LLM. Trả về kết quả (đối tượng thuần) và, nếu là tool ghi, việc chờ xác nhận.
 * ⭐ Tool ghi KHÔNG BAO GIỜ được `execute` ở đây — chỉ `preview` rồi tạo `pendingAction` (docs/07 mục 8).
 */
async function handleToolCall({ call, userId, pending, now }) {
  const tool = getTool(call.name);
  if (!tool) return { result: { error: { code: 'UNKNOWN_TOOL', message: `Không có tool tên "${call.name}".` } } };

  const parsed = tool.schema.safeParse(call.input ?? {});
  if (!parsed.success) return { result: { error: { code: 'VALIDATION_ERROR', message: `Tham số không hợp lệ — ${zodMessage(parsed.error)}` } } };
  const input = parsed.data;

  try {
    if (tool.kind === 'read') return { result: await tool.run({ userId, input }) };

    if (pending) {
      return { result: { error: { code: 'ALREADY_PENDING', message: 'Đang có một thao tác chờ khách xác nhận. Hãy đợi khách xác nhận hoặc từ chối trước khi đề xuất thao tác khác.' } } };
    }
    const { summary } = await tool.preview({ userId, input });
    const action = {
      actionId: randomUUID(), tool: tool.name, input, summary,
      createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + PENDING_TTL_MS).toISOString(),
    };
    return { result: { status: 'AWAITING_USER_CONFIRMATION', summary }, pending: action };
  } catch (err) {
    return { result: toToolError(err) };
  }
}

const serialize = (result) => {
  const text = JSON.stringify(result);
  return text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}…[đã cắt bớt]` : text;
};

/**
 * Một lượt xử lý tin nhắn của khách: gọi LLM, chạy các tool ĐỌC, dừng ở tool GHI (chỉ đề xuất), lặp tối đa MAX_STEPS vòng.
 * Không import Prisma, không đụng req/res: chỉ gọi services thông qua `tools.js` (kiến trúc docs/07 mục 9).
 *
 * @param {{ userId: string, llm: { complete: Function }, system: string,
 *   history: Array<object>, now?: Date, maxSteps?: number }} params
 *   `history` là các tin ĐÃ CÓ (gồm cả tin mới nhất của khách ở cuối), theo giao diện trong llm/index.js.
 * @returns {Promise<{ text: string, pendingAction: object|null, newMessages: Array<object>, usage: { inputTokens: number, outputTokens: number }, steps: number }>}
 *   `newMessages` là các tin phát sinh trong lượt này (assistant / tool) để lưu vào ChatMessage.
 */
export async function runAgentTurn({ userId, llm, system, history, now = new Date(), maxSteps = MAX_STEPS }) {
  const messages = [...history];
  const newMessages = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  const push = (m) => { messages.push(m); newMessages.push(m); };
  let pending = null;
  const tools = toolSpecs();

  for (let step = 1; step <= maxSteps; step++) {
    const out = await llm.complete({ system, messages, tools, maxTokens: MAX_TOKENS });
    usage.inputTokens += out.usage?.inputTokens ?? 0;
    usage.outputTokens += out.usage?.outputTokens ?? 0;
    const toolCalls = out.toolCalls ?? [];

    if (toolCalls.length === 0) {
      const text = (out.text ?? '').trim() || (pending ? 'Bạn xác nhận thao tác bên dưới nhé.' : FALLBACK_TEXT);
      push({ role: 'assistant', content: text });
      return { text, pendingAction: pending, newMessages, usage, steps: step };
    }

    push({ role: 'assistant', content: out.text ?? '', toolCalls });
    for (const call of toolCalls) {
      const out = await handleToolCall({ call, userId, pending, now });
      if (out.pending) pending = out.pending;
      push({ role: 'tool', toolCallId: call.id, name: call.name, content: serialize(out.result) });
    }
  }

  // Hết số vòng cho phép mà LLM vẫn chỉ gọi tool: dừng lại, không để treo / tốn thêm.
  const text = pending ? 'Bạn xác nhận thao tác bên dưới nhé.' : FALLBACK_TEXT;
  push({ role: 'assistant', content: text });
  return { text, pendingAction: pending, newMessages, usage, steps: maxSteps };
}
