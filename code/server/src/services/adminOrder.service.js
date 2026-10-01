import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { buildMeta, toSkipTake } from '../utils/pagination.js';
import { orderInclude, toOrderDto } from './booking.service.js';
import { vnDayRange } from './showtime.service.js';

/**
 * Danh sách đơn cho trang quản trị: lọc theo trạng thái, khoảng ngày tạo (giờ VN), tìm theo mã đơn / email / họ tên.
 * @param {{ status?: string, from?: string, to?: string, q?: string, page: number, pageSize: number }} params from/to: YYYY-MM-DD
 * @returns {Promise<{ items: object[], meta: object }>}
 */
export async function listAdminOrders({ status, from, to, q, page, pageSize }) {
  const keyword = q?.trim();
  const where = {
    ...(status && { status }),
    ...((from || to) && {
      createdAt: { ...(from && { gte: vnDayRange(from).from }), ...(to && { lt: vnDayRange(to).to }) }, // `to` gồm cả ngày đó
    }),
    ...(keyword && {
      OR: [
        { code: { contains: keyword.toUpperCase() } },
        { user: { email: { contains: keyword, mode: 'insensitive' } } },
        { user: { fullName: { contains: keyword, mode: 'insensitive' } } },
      ],
    }),
  };
  const [total, rows] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...toSkipTake({ page, pageSize }),
      select: {
        id: true, code: true, status: true, total: true, createdAt: true, paidAt: true, checkedInAt: true,
        user: { select: { id: true, email: true, fullName: true } },
        seats: { select: { seatLabel: true }, orderBy: { seatLabel: 'asc' } },
        showtime: { select: { startTime: true, movie: { select: { title: true } }, room: { select: { cinema: { select: { name: true } } } } } },
      },
    }),
  ]);
  const items = rows.map(({ seats, showtime, ...o }) => ({
    ...o,
    seatLabels: seats.map((s) => s.seatLabel),
    showtime: { startTime: showtime.startTime, movieTitle: showtime.movie.title, cinemaName: showtime.room.cinema.name },
  }));
  return { items, meta: buildMeta({ page, pageSize }, total) };
}

/**
 * Chi tiết một đơn (bất kể của ai) kèm khách hàng và lịch sử giao dịch — để admin đối soát.
 * @param {{ orderId: string }} params
 * @returns {Promise<object>} `Order` + `user` + `payments[]`
 * @throws {AppError} NOT_FOUND
 */
export async function getAdminOrder({ orderId }) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      ...orderInclude,
      user: { select: { id: true, email: true, fullName: true, phone: true } },
      payments: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, txnRef: true, amount: true, status: true, bankCode: true, providerTxnNo: true, responseCode: true, createdAt: true, paidAt: true },
      },
    },
  });
  if (!order) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy đơn hàng.' });
  return { ...toOrderDto(order), user: order.user, payments: order.payments };
}

/**
 * Ghi nhận ĐÃ HOÀN TIỀN thủ công: chỉ REFUND_PENDING -> REFUNDED (BR-31). Hệ thống không tự chuyển tiền;
 * admin hoàn qua cổng VNPay rồi bấm xác nhận ở đây.
 * Là MỘT câu cập nhật có điều kiện nên hai admin bấm cùng lúc thì chỉ một người thành công (người kia nhận lỗi).
 * @param {{ orderId: string }} params
 * @returns {Promise<object>} đơn sau khi cập nhật (như getAdminOrder)
 * @throws {AppError} NOT_FOUND | ORDER_NOT_PENDING (đơn không ở trạng thái chờ hoàn tiền)
 */
export async function refundOrder({ orderId }) {
  const { count } = await prisma.order.updateMany({
    where: { id: orderId, status: 'REFUND_PENDING' },
    data: { status: 'REFUNDED' },
  });
  if (count === 0) {
    const exists = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true } });
    if (!exists) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy đơn hàng.' });
    throw new AppError('ORDER_NOT_PENDING', { message: 'Chỉ đơn đang chờ hoàn tiền mới ghi nhận hoàn tiền được.' });
  }
  return getAdminOrder({ orderId });
}
