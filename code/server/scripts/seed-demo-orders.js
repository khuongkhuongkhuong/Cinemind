// Dữ liệu DEMO: khách hàng + đơn hàng đã bán, để trang Tổng quan (doanh thu), Đơn hàng, Vé của tôi có số liệu thật.
// Chạy SAU `npm run db:seed`:   npm run db:demo            (đơn rải đều 14 ngày qua)
//                              npm run db:demo -- --live  (thêm một suất bắt đầu sau ~25 phút + vé của user mẫu, để demo SOÁT VÉ)
//                              npm run db:demo -- --only-live  (chỉ bước trên, không tạo thêm đơn hàng loạt — chạy lại ngay trước buổi demo)
//
// Mọi đơn đi qua ĐÚNG các service thật (holdSeats -> setCombos -> createPayment -> simulateIpn): giữ ghế bằng khóa chính SeatLock,
// IPN có chữ ký và kiểm số tiền. Chỉ có MỘT bước "đạo cụ": lùi `createdAt` / `paidAt` về quá khứ để biểu đồ doanh thu có nhiều ngày.
import { prisma } from '../src/config/prisma.js';
import { holdSeats, setCombos, cancelOrder } from '../src/services/booking.service.js';
import { createPayment, simulateIpn } from '../src/services/payment.service.js';
import { createShowtime } from '../src/services/showtime.service.js';

if (process.env.NODE_ENV === 'production') throw new Error('Không chạy dữ liệu demo trên production.');

const ONLY_LIVE = process.argv.includes('--only-live');
const LIVE = ONLY_LIVE || process.argv.includes('--live');
const DAY = 24 * 3600_000;
const ORDER_COUNT = 45;

// Bộ sinh số ngẫu nhiên cố định (chạy lại cho kết quả giống nhau, dễ chuẩn bị kịch bản).
let seed = 20261101;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (list) => list[Math.floor(rand() * list.length)];

async function ensureCustomers() {
  const template = await prisma.user.findUnique({ where: { email: 'user@cinemind.vn' } });
  if (!template) throw new Error('Chưa có dữ liệu mẫu: chạy `npm run db:seed` trước.');
  const people = ['An', 'Bình', 'Chi', 'Dũng', 'Hà', 'Khoa'];
  const users = [template];
  for (const [i, name] of people.entries()) {
    users.push(await prisma.user.upsert({
      where: { email: `demo${i + 1}@cinemind.vn` },
      update: {},
      create: { email: `demo${i + 1}@cinemind.vn`, fullName: `Khách ${name}`, passwordHash: template.passwordHash },
    }));
  }
  return users;
}

/** Chọn ngẫu nhiên `count` ghế đơn (không phải ghế đôi) còn trống của suất. */
async function freeSeats(showtime, count) {
  const locked = new Set((await prisma.seatLock.findMany({ where: { showtimeId: showtime.id }, select: { seatId: true } })).map((l) => l.seatId));
  const seats = await prisma.seat.findMany({ where: { roomId: showtime.roomId, isActive: true, type: { not: 'COUPLE' } }, select: { id: true } });
  const free = seats.filter((s) => !locked.has(s.id));
  const chosen = [];
  while (chosen.length < count && free.length) chosen.push(free.splice(Math.floor(rand() * free.length), 1)[0].id);
  return chosen;
}

/** Một đơn đầy đủ: giữ ghế -> (combo) -> thanh toán -> IPN giả lập thành công. */
async function buyTicket({ user, showtime, withCombo }) {
  const seatIds = await freeSeats(showtime, 1 + Math.floor(rand() * 4));
  if (!seatIds.length) return null;
  let order = await holdSeats({ userId: user.id, showtimeId: showtime.id, seatIds });
  if (withCombo.length) order = await setCombos({ userId: user.id, orderId: order.id, items: withCombo });
  const pay = await createPayment({ userId: user.id, orderId: order.id });
  await simulateIpn({ txnRef: pay.txnRef, result: 'SUCCESS' });
  return { orderId: order.id, txnRef: pay.txnRef };
}

/** Đạo cụ demo: lùi thời điểm tạo / thanh toán về `paidAt` để biểu đồ doanh thu có nhiều ngày. */
async function backdate({ orderId, txnRef }, paidAt) {
  const createdAt = new Date(paidAt.getTime() - 5 * 60_000);
  await prisma.order.update({ where: { id: orderId }, data: { createdAt, paidAt } });
  await prisma.payment.update({ where: { txnRef }, data: { createdAt, paidAt } });
}

/** Tìm hoặc tạo "Phòng Demo" cùng rạp và cùng sơ đồ ghế với phòng `templateRoomId`. */
async function ensureDemoRoom(templateRoomId) {
  const template = await prisma.room.findUnique({ where: { id: templateRoomId }, include: { seats: true } });
  const existing = await prisma.room.findFirst({ where: { cinemaId: template.cinemaId, name: 'Phòng Demo' } });
  if (existing) return existing;
  const room = await prisma.room.create({ data: { cinemaId: template.cinemaId, name: 'Phòng Demo' } });
  await prisma.seat.createMany({
    data: template.seats.map((x) => ({ roomId: room.id, row: x.row, number: x.number, type: x.type, pairCode: x.pairCode, isActive: x.isActive })),
  });
  return room;
}

const customers = await ensureCustomers();
const combos = await prisma.combo.findMany({ where: { isActive: true } });
const showtimes = await prisma.showtime.findMany({ where: { status: 'OPEN', startTime: { gt: new Date(Date.now() + 2 * 3600_000) } }, orderBy: { startTime: 'asc' } });
if (!showtimes.length) throw new Error('Không có suất chiếu sắp tới: chạy `npm run db:seed` trước.');

let paid = 0;
if (!ONLY_LIVE) {
  for (let i = 0; i < ORDER_COUNT; i++) {
    const withCombo = rand() < 0.5 ? [{ comboId: pick(combos).id, quantity: 1 + Math.floor(rand() * 2) }] : [];
    const sold = await buyTicket({ user: pick(customers), showtime: pick(showtimes), withCombo });
    if (!sold) continue;
    // Doanh thu nhiều hơn ở những ngày gần đây (xu hướng tăng) để biểu đồ trông tự nhiên.
    const daysAgo = Math.floor(14 * (1 - Math.sqrt(rand())));
    await backdate(sold, new Date(Date.now() - daysAgo * DAY - Math.floor(rand() * 10) * 3600_000));
    paid += 1;
  }

  // Một vài đơn "không đẹp" để demo các trạng thái: đã hủy, và MỘT đơn chờ hoàn tiền (admin bấm "Ghi nhận đã hoàn tiền").
  for (let i = 0; i < 3; i++) {
    const st = pick(showtimes);
    const user = pick(customers);
    const order = await holdSeats({ userId: user.id, showtimeId: st.id, seatIds: await freeSeats(st, 2) });
    await cancelOrder({ userId: user.id, orderId: order.id });
  }
  const refundCandidate = await prisma.order.findFirst({ where: { status: 'PAID' }, orderBy: { paidAt: 'desc' } });
  if (refundCandidate) {
    // Trong hệ thống thật trạng thái này đến từ IPN muộn (ghế đã bị người khác lấy / suất đã hủy); ở đây đặt trực tiếp cho kịch bản demo.
    await prisma.order.update({ where: { id: refundCandidate.id }, data: { status: 'REFUND_PENDING' } });
  }
}

let live = null;
if (LIVE) {
  const source = showtimes[0];
  const start = new Date(Date.now() + 25 * 60_000);
  // Dữ liệu seed phủ kín mọi phòng suốt ngày, nên dùng riêng một "Phòng Demo" (sao chép sơ đồ ghế từ phòng có sẵn).
  const room = await ensureDemoRoom(source.roomId);
  const roomId = room.id;
  const st = await createShowtime({ movieId: source.movieId, roomId, startTime: start, format: source.format, audio: source.audio });
  const user = customers[0]; // user@cinemind.vn
  const sold = await buyTicket({ user, showtime: { id: st.id, roomId }, withCombo: [] });
  const order = await prisma.order.findUnique({ where: { id: sold.orderId }, select: { code: true } });
  live = { code: order.code, start };
}

const totals = await prisma.order.groupBy({ by: ['status'], _count: true });
console.log('Đơn theo trạng thái:', Object.fromEntries(totals.map((t) => [t.status, t._count])));
if (!ONLY_LIVE) console.log(`Đã tạo ${paid} đơn đã thanh toán (rải 14 ngày qua), 3 đơn hủy, 1 đơn chờ hoàn tiền.`);
if (live) console.log(`Demo soát vé: vé ${live.code} của user@cinemind.vn, suất bắt đầu lúc ${live.start.toLocaleTimeString('vi-VN')} (soát được trong khoảng ±30 phút).`);
await prisma.$disconnect();
