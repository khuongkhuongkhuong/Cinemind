// Dọn dữ liệu rác của test bị ngắt giữa chừng (user có email bắt đầu bằng "test-"). Chạy: npm run db:clean-test
import { prisma } from '../src/config/prisma.js';

const where = { user: { email: { startsWith: 'test-' } } };
await prisma.payment.deleteMany({ where: { order: where } }); // Payment không cascade nên xóa trước
// Phòng/suất do test admin tạo (phòng tên TestRoom-...)
const testRooms = await prisma.room.findMany({ where: { name: { startsWith: 'TestRoom-' } }, select: { id: true } });
const roomIds = testRooms.map((r) => r.id);
await prisma.order.deleteMany({ where: { showtime: { roomId: { in: roomIds } } } });
await prisma.showtime.deleteMany({ where: { roomId: { in: roomIds } } });
await prisma.room.deleteMany({ where: { id: { in: roomIds } } });
// Phim do test admin tạo (mô tả cố định 'Mô tả thử') và chưa có suất chiếu
await prisma.movie.deleteMany({ where: { description: 'Mô tả thử', showtimes: { none: {} } } });
const orders = await prisma.order.deleteMany({ where }); // SeatLock, OrderSeat xóa theo (cascade)
const users = await prisma.user.deleteMany({ where: { email: { startsWith: 'test-' } } });
console.log(`Đã xóa ${orders.count} đơn và ${users.count} user test.`);
await prisma.$disconnect();
