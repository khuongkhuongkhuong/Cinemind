import { AppError } from '../../utils/AppError.js';

/**
 * Giao diện LLM (trung lập nhà cung cấp) — mọi adapter phải có một hàm:
 *
 *   complete({ system, messages, tools, maxTokens }) -> Promise<{ text, toolCalls, usage? }>
 *
 * - `messages`: mảng tin theo thứ tự thời gian, mỗi phần tử là MỘT trong
 *     { role: 'user', content }
 *     { role: 'assistant', content, toolCalls?: [{ id, name, input }] }
 *     { role: 'tool', toolCallId, name, content }   // kết quả của một lần gọi tool (chuỗi JSON)
 * - `tools`: [{ name, description, inputSchema }] (JSON Schema)
 * - trả về `text` (có thể rỗng) và `toolCalls` ([] nếu LLM đã trả lời xong).
 *
 * Nhờ vậy vòng lặp Agent không biết gì về nhà cung cấp: test dùng `llm/fake.js`, chạy thật dùng adapter Anthropic.
 */
let current = null;

/** Gắn LLM sẽ dùng (test gắn mô hình giả; khi khởi động server gắn adapter thật nếu có khóa). Truyền null để gỡ. */
export function setLlm(llm) {
  current = llm;
}

/**
 * Lấy LLM hiện tại.
 * @returns {{ complete: Function }}
 * @throws {AppError} AI_UNAVAILABLE khi chưa cấu hình (không có khóa API) — không lộ chi tiết kỹ thuật ra ngoài
 */
export function getLlm() {
  if (!current) throw new AppError('AI_UNAVAILABLE');
  return current;
}
