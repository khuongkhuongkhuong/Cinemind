// Dọn dữ liệu rác của test bị ngắt giữa chừng (user có email bắt đầu bằng "test-"). Chạy: npm run db:clean-test
import { prisma } from '../src/config/prisma.js';

const where = { user: { email: { startsWith: 'test-' } } };
await prisma.payment.deleteMany({ where: { order: where } }); // Payment không cascade nên xóa trước
const orders = await prisma.order.deleteMany({ where }); // SeatLock, OrderSeat xóa theo (cascade)
const users = await prisma.user.deleteMany({ where: { email: { startsWith: 'test-' } } });
console.log(`Đã xóa ${orders.count} đơn và ${users.count} user test.`);
await prisma.$disconnect();
