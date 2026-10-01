import app from './app.js';
import { env } from './config/env.js';
import { startExpireOrdersJob } from './jobs/expireOrders.job.js';
import { devRoutesEnabled } from './routes/index.js';

app.listen(env.PORT, () => {
  console.log(`Cinemind server chạy tại http://localhost:${env.PORT}/api/v1`);
  if (devRoutesEnabled) console.warn('[CẢNH BÁO] Cổng giả lập thanh toán /dev đang BẬT: ai cũng đánh dấu được đơn đã trả tiền. Chỉ dùng khi phát triển/demo.');
  startExpireOrdersJob(); // chỉ bật khi chạy server thật (test import app.js nên không chạy job)
});
