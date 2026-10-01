import cron from 'node-cron';
import { expirePendingOrders } from '../services/booking.service.js';

let running = false; // chống chạy chồng nếu một lượt còn chưa xong thì phút sau bỏ qua

/** Mỗi phút dọn đơn PENDING hết hạn. Logic nằm ở service; job chỉ là bộ hẹn giờ. */
export function startExpireOrdersJob() {
  return cron.schedule('* * * * *', async () => {
    if (running) return;
    running = true;
    try {
      const n = await expirePendingOrders();
      if (n > 0) console.log(`[expireOrders] đã chuyển ${n} đơn sang EXPIRED`);
    } catch (err) {
      console.error('[expireOrders] lỗi:', err);
    } finally {
      running = false;
    }
  });
}
