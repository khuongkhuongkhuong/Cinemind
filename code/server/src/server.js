import app from './app.js';
import { env } from './config/env.js';
import { startExpireOrdersJob } from './jobs/expireOrders.job.js';

app.listen(env.PORT, () => {
  console.log(`Cinemind server chạy tại http://localhost:${env.PORT}/api/v1`);
  startExpireOrdersJob(); // chỉ bật khi chạy server thật (test import app.js nên không chạy job)
});
