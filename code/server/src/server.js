import app from './app.js';
import { env } from './config/env.js';
import { startExpireOrdersJob } from './jobs/expireOrders.job.js';
import { devRoutesEnabled } from './routes/index.js';
import { setLlm } from './ai/llm/index.js';
import { createAnthropicLlm } from './ai/llm/anthropic.js';

// Nối trợ lý AI thật khi có khóa API; không có thì để trống (chat trả AI_UNAVAILABLE, không ảnh hưởng đặt vé).
if (env.ANTHROPIC_API_KEY) {
  setLlm(createAnthropicLlm({ apiKey: env.ANTHROPIC_API_KEY, model: env.AI_MODEL, effort: env.AI_EFFORT, refusalFallback: env.AI_REFUSAL_FALLBACK }));
}

app.listen(env.PORT, () => {
  console.log(`Cinemind server chạy tại http://localhost:${env.PORT}/api/v1`);
  if (devRoutesEnabled) console.warn('[CẢNH BÁO] Cổng giả lập thanh toán /dev đang BẬT: ai cũng đánh dấu được đơn đã trả tiền. Chỉ dùng khi phát triển/demo.');
  console.log(env.ANTHROPIC_API_KEY ? `Trợ lý AI: BẬT (mô hình ${env.AI_MODEL}, effort ${env.AI_EFFORT})` : 'Trợ lý AI: TẮT (chưa có ANTHROPIC_API_KEY trong .env)');
  startExpireOrdersJob(); // chỉ bật khi chạy server thật (test import app.js nên không chạy job)
});
