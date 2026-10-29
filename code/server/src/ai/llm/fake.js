/**
 * Mô hình giả có kịch bản — dùng trong test (miễn phí, ổn định, kiểm soát được từng bước).
 *
 * `script` là mảng các bước; mỗi lần Agent gọi `complete` thì lấy bước kế tiếp. Một bước là:
 *   - object  { text?, toolCalls?: [{ name, input }] }
 *   - hoặc hàm (ctx) => object, với ctx = { system, messages, tools, callIndex } — để "mô hình" phản ứng theo
 *     dữ liệu tool vừa nhận (ví dụ: bị tiêm lệnh qua mô tả phim rồi làm theo).
 * Hết kịch bản thì trả lời "(hết kịch bản)" để vòng lặp kết thúc thay vì treo.
 *
 * `fake.calls` ghi lại mọi lần gọi (system, messages, tools) để test kiểm chứng điều đã gửi cho LLM.
 */
export function createFakeLlm(script = []) {
  let index = 0;
  let idCounter = 0;
  const calls = [];
  return {
    calls,
    async complete({ system, messages, tools, maxTokens }) {
      const callIndex = index++;
      calls.push({ system, messages: structuredClone(messages), tools, maxTokens, callIndex });
      let step = script[callIndex] ?? { text: '(hết kịch bản)' };
      if (typeof step === 'function') step = step({ system, messages, tools, callIndex });
      if (step instanceof Error) throw step;
      return {
        text: step.text ?? '',
        toolCalls: (step.toolCalls ?? []).map((c) => ({ id: c.id ?? `call_${++idCounter}`, name: c.name, input: c.input ?? {} })),
        usage: step.usage ?? { inputTokens: 100, outputTokens: 20 },
      };
    },
  };
}
