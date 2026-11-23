import Anthropic from '@anthropic-ai/sdk';

/**
 * Bộ chuyển (adapter) Anthropic cho giao diện LLM trung lập (xem `llm/index.js`): `complete({ system, messages, tools, maxTokens })`.
 * Mỗi lần gọi là MỘT yêu cầu `messages.create`; vòng lặp gọi công cụ do `ai/agent.js` điều khiển (đúng thiết kế docs/07: tool ghi KHÔNG
 * chạy ở đây, chỉ tạo đề xuất chờ khách xác nhận). Module này chỉ dịch qua lại giữa hai dạng tin nhắn và gọi API.
 */

export const DEFAULT_MODEL = 'claude-opus-5-5';
export const REFUSAL_TEXT = 'Mình không thể hỗ trợ yêu cầu này. Bạn thử diễn đạt khác, hoặc đặt vé trực tiếp trên trang nhé.';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/**
 * Tin nhắn nội bộ -> tin nhắn của Anthropic.
 * - `assistant` có `toolCalls` -> khối `text` (nếu có) + các khối `tool_use`.
 * - Các tin `tool` LIỀN NHAU (kết quả của cùng một lượt gọi song song) -> MỘT tin `user` chứa nhiều khối `tool_result`
 *   (tách ra nhiều tin sẽ dạy mô hình ngừng gọi công cụ song song).
 * @param {Array<object>} messages theo giao diện trong llm/index.js
 * @returns {Array<{ role: 'user'|'assistant', content: string|object[] }>}
 */
export function toAnthropicMessages(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      const calls = m.toolCalls ?? [];
      if (calls.length === 0) {
        out.push({ role: 'assistant', content: m.content });
      } else {
        out.push({
          role: 'assistant',
          content: [
            ...(m.content ? [{ type: 'text', text: m.content }] : []),
            ...calls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.input ?? {} })),
          ],
        });
      }
    } else if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
      const last = out.at(-1);
      if (last?.role === 'user' && Array.isArray(last.content) && last.content.every((b) => b.type === 'tool_result')) last.content.push(block);
      else out.push({ role: 'user', content: [block] });
    } else {
      throw new Error(`Vai trò tin nhắn không hỗ trợ: ${m.role}`);
    }
  }
  return out;
}

/** Công cụ nội bộ `{ name, description, inputSchema }` -> định dạng của Anthropic `{ name, description, input_schema }`. */
export const toAnthropicTools = (tools) => tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));

/**
 * Tạo LLM chạy bằng Anthropic.
 * @param {{ apiKey?: string, client?: object, model?: string, effort?: 'low'|'medium'|'high'|'xhigh'|'max', refusalFallback?: boolean,
 *   timeoutMs?: number }} [options]
 *   `client`: tiêm một client có sẵn (test dùng client giả, không tốn token). Không truyền thì tạo `new Anthropic` từ `apiKey`.
 *   `effort`: độ "suy nghĩ" — mặc định `low` vì trò chuyện + gọi công cụ ngắn không cần nhiều (rẻ và nhanh hơn).
 *   `refusalFallback`: bật `fallbacks: "default"` phía server — nếu bộ lọc an toàn từ chối thì API tự chạy lại trên mô hình dự phòng.
 * @returns {{ complete: (args: { system: string, messages: object[], tools: object[], maxTokens: number }) =>
 *   Promise<{ text: string, toolCalls: Array<{ id: string, name: string, input: object }>, usage: { inputTokens: number, outputTokens: number } }> }}
 */
export function createAnthropicLlm({
  apiKey, client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 }), model = DEFAULT_MODEL, effort = 'low', refusalFallback = true,
} = {}) {
  return {
    async complete({ system, messages, tools, maxTokens }) {
      const params = {
        model,
        max_tokens: maxTokens,
        system,
        messages: toAnthropicMessages(messages),
        tools: toAnthropicTools(tools),
        output_config: { effort },
        ...(refusalFallback && { betas: [FALLBACK_BETA], fallbacks: 'default' }),
      };
      const response = await (refusalFallback ? client.beta.messages.create(params) : client.messages.create(params));

      const usage = {
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
        cacheReadTokens: response.usage?.cache_read_input_tokens ?? 0,
      };
      // Cả chuỗi (mô hình chính + dự phòng) đều từ chối: trả lời lịch sự, không ném lỗi.
      if (response.stop_reason === 'refusal') return { text: REFUSAL_TEXT, toolCalls: [], usage };

      const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      const toolCalls = response.content
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({ id: b.id, name: b.name, input: b.input ?? {} }));
      // Bị cắt giữa chừng khi đang viết lời gọi công cụ: tham số có thể thiếu -> KHÔNG chạy; để lớp trên báo "tạm nghỉ".
      if (response.stop_reason === 'max_tokens' && toolCalls.length > 0) throw new Error('LLM_TRUNCATED_TOOL_CALL');
      return { text, toolCalls, usage };
    },
  };
}
