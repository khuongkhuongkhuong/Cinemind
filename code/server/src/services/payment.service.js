import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { buildPaymentUrl, formatVnpDate, sign, verifySignature } from '../lib/vnpay.js';

// Điểm thưởng (BR-25, Could): 1 điểm / 10.000đ thực trả.
const POINT_UNIT = 10_000;

const requireVnpConfig = () => {
  if (!env.VNP_TMN_CODE || !env.VNP_HASH_SECRET || !env.VNP_URL || !env.VNP_RETURN_URL) {
    throw new AppError('INTERNAL_ERROR', { message: 'Chưa cấu hình VNPay (VNP_TMN_CODE, VNP_HASH_SECRET, VNP_URL, VNP_RETURN_URL).' });
  }
};

/**
 * Tạo giao dịch thanh toán cho đơn và trả link VNPay. Hạn thanh toán = hạn giữ ghế (BR-30).
 * @param {{ userId: string, orderId: string, bankCode?: string, ipAddr?: string }} params
 * @returns {Promise<{ paymentId: string, txnRef: string, paymentUrl: string, expiresAt: Date }>}
 * @throws {AppError} NOT_FOUND | FORBIDDEN | ORDER_EXPIRED | ORDER_NOT_PENDING
 */
export async function createPayment({ userId, orderId, bankCode, ipAddr = '127.0.0.1' }) {
  requireVnpConfig();
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy đơn hàng.' });
  if (order.userId !== userId) throw new AppError('FORBIDDEN');
  if (order.status !== 'PENDING') throw new AppError('ORDER_NOT_PENDING');
  if (order.expiresAt <= new Date()) throw new AppError('ORDER_EXPIRED');

  // Mỗi lần bấm "Thanh toán" là một giao dịch mới: txnRef = <mã đơn>-<lần thứ n>. UNIQUE chặn trùng.
  let payment;
  for (let attempt = 0; attempt < 3 && !payment; attempt++) {
    const n = (await prisma.payment.count({ where: { orderId } })) + 1 + attempt;
    try {
      payment = await prisma.payment.create({
        data: { orderId, txnRef: `${order.code}-${n}`, amount: order.total, bankCode: bankCode ?? null },
      });
    } catch (err) {
      if (err.code !== 'P2002') throw err;
    }
  }
  if (!payment) throw new AppError('INTERNAL_ERROR');

  const params = {
    vnp_Version: '2.1.0',
    vnp_Command: 'pay',
    vnp_TmnCode: env.VNP_TMN_CODE,
    vnp_Amount: payment.amount * 100, // VNPay quy định nhân 100, bỏ phần thập phân
    vnp_CreateDate: formatVnpDate(new Date()),
    vnp_ExpireDate: formatVnpDate(order.expiresAt),
    vnp_CurrCode: 'VND',
    vnp_IpAddr: ipAddr,
    vnp_Locale: 'vn',
    vnp_OrderInfo: `Thanh toan ve Cinemind ${order.code}`, // không dấu theo yêu cầu VNPay
    vnp_OrderType: 'other',
    vnp_ReturnUrl: env.VNP_RETURN_URL,
    vnp_TxnRef: payment.txnRef,
    ...(bankCode && { vnp_BankCode: bankCode }),
  };
  const paymentUrl = buildPaymentUrl({ baseUrl: env.VNP_URL, params, secret: env.VNP_HASH_SECRET });
  return { paymentId: payment.id, txnRef: payment.txnRef, paymentUrl, expiresAt: order.expiresAt };
}

/** Phản hồi theo định dạng VNPay (04-api-contract mục 3.6). */
const RSP = {
  ok: { RspCode: '00', Message: 'Confirm Success' },
  notFound: { RspCode: '01', Message: 'Order not found' },
  already: { RspCode: '02', Message: 'Order already confirmed' },
  badAmount: { RspCode: '04', Message: 'Invalid amount' },
  badSignature: { RspCode: '97', Message: 'Invalid signature' },
};

/**
 * ⭐ Xác nhận thanh toán từ IPN của VNPay — NƠI DUY NHẤT được chuyển đơn sang PAID.
 * Idempotent (gọi lặp không gây hại) và dùng chung một thuật toán cho IPN đúng hạn lẫn đến muộn
 * (03-database mục 5.7). Không ném lỗi nghiệp vụ: luôn trả object `{ RspCode, Message }` cho VNPay.
 * @param {{ query: Record<string, string> }} params toàn bộ query `vnp_*` VNPay gửi tới
 * @returns {Promise<{ RspCode: string, Message: string }>}
 */
export async function confirmPayment({ query }) {
  requireVnpConfig();
  // 1. Chữ ký: sai là bỏ qua hoàn toàn, không đụng DB.
  if (!verifySignature(query, env.VNP_HASH_SECRET)) return RSP.badSignature;

  // 2. Giao dịch phải tồn tại và số tiền phải khớp CHÍNH XÁC với số server đã ghi (không tin con số nào từ ngoài).
  const payment = await prisma.payment.findUnique({ where: { txnRef: query.vnp_TxnRef ?? '' } });
  if (!payment || query.vnp_TmnCode !== env.VNP_TMN_CODE) return RSP.notFound;
  if (Number(query.vnp_Amount) !== payment.amount * 100) return RSP.badAmount;

  // 3. Đã xử lý rồi (VNPay gọi lặp) -> báo "đã xác nhận", không làm gì thêm.
  if (payment.status !== 'PENDING') return RSP.already;

  const rawData = query;
  const succeeded = query.vnp_ResponseCode === '00' && query.vnp_TransactionStatus === '00'; // phải cả hai là 00

  // 4. Thất bại: ghi nhận, đơn giữ nguyên để người dùng thử lại trong thời hạn giữ ghế.
  if (!succeeded) {
    const { count } = await prisma.payment.updateMany({
      where: { id: payment.id, status: 'PENDING' },
      data: { status: 'FAILED', responseCode: query.vnp_ResponseCode ?? null, providerTxnNo: query.vnp_TransactionNo ?? null, rawData },
    });
    return count === 1 ? RSP.ok : RSP.already;
  }

  // 5. Thành công: transaction xác nhận. P2002 (ghế đã bị người khác lấy) -> rollback rồi chuyển REFUND_PENDING.
  try {
    const confirmed = await prisma.$transaction((tx) => markPaid(tx, payment, query), { maxWait: 10_000, timeout: 15_000 });
    return confirmed ? RSP.ok : RSP.already;
  } catch (err) {
    if (err.code !== 'P2002') throw err;
    // 6. Ghế đã mất (chỉ xảy ra khi IPN đến muộn, BR-31): tiền đã thu nên ghi SUCCESS, đơn chờ hoàn tiền.
    const marked = await prisma.$transaction(async (tx) => {
      const claim = await tx.payment.updateMany({
        where: { id: payment.id, status: 'PENDING' },
        data: { status: 'SUCCESS', ...paymentFields(query), paidAt: new Date(), rawData },
      });
      if (claim.count === 1) await tx.order.update({ where: { id: payment.orderId }, data: { status: 'REFUND_PENDING' } });
      return claim.count === 1;
    });
    return marked ? RSP.ok : RSP.already;
  }
}

const paymentFields = (query) => ({
  responseCode: query.vnp_ResponseCode ?? null,
  providerTxnNo: query.vnp_TransactionNo ?? null,
  bankCode: query.vnp_BankCode ?? undefined,
});

/** Phần ruột của transaction xác nhận. Trả false nếu một IPN khác đã xử lý trước (idempotent). */
async function markPaid(tx, payment, query) {
  // "Giành" giao dịch: PENDING -> SUCCESS trong MỘT câu lệnh có điều kiện. Hai IPN trùng nhau chạy cùng lúc:
  // cái thứ hai bị chặn chờ cái đầu commit rồi thấy status đã SUCCESS => count = 0 => dừng. Đây là idempotency.
  const claim = await tx.payment.updateMany({
    where: { id: payment.id, status: 'PENDING' },
    data: { status: 'SUCCESS', ...paymentFields(query), paidAt: new Date(), rawData: query },
  });
  if (claim.count === 0) return false;

  const order = await tx.order.findUnique({ where: { id: payment.orderId }, include: { seats: true } });
  // Chỉ đơn PENDING/EXPIRED/CANCELLED mới đi tiếp. Đơn đã PAID/REFUND_*: giao dịch này là khoản thu thừa,
  // chỉ ghi nhận SUCCESS (đã làm ở trên), admin xử lý hoàn tiền thủ công.
  if (!['PENDING', 'EXPIRED', 'CANCELLED'].includes(order.status)) return true;

  // Số tiền đã thu phải KHỚP tổng đơn hiện tại. Khách tạo link thanh toán rồi đổi combo/mã giảm giá thì tổng đổi;
  // trả theo link cũ sẽ thu sai số tiền => KHÔNG ghi PAID. Ghi nhận khoản thu, nhả ghế, chờ admin hoàn tiền.
  if (order.total !== payment.amount) {
    await tx.seatLock.deleteMany({ where: { orderId: order.id } });
    await tx.order.update({ where: { id: order.id }, data: { status: 'REFUND_PENDING' } });
    return true;
  }

  // Xóa lượt giữ HELD đã quá hạn của NGƯỜI KHÁC trên các ghế của đơn, để ta có thể chiếm chỗ.
  const seatIds = order.seats.map((s) => s.seatId);
  await tx.seatLock.deleteMany({
    where: { showtimeId: order.showtimeId, seatId: { in: seatIds }, status: 'HELD', expiresAt: { lte: new Date() }, orderId: { not: order.id } },
  });

  for (const s of order.seats) {
    // Lượt giữ của chính đơn còn -> chuyển SOLD. Mất rồi (cron đã dọn / đơn đã hết hạn) -> chèn mới;
    // nếu ghế đã thuộc người khác thì khóa chính báo P2002 và ta rollback (bước 6).
    const own = await tx.seatLock.updateMany({
      where: { showtimeId: order.showtimeId, seatId: s.seatId, orderId: order.id },
      data: { status: 'SOLD', expiresAt: null },
    });
    if (own.count === 0) {
      await tx.seatLock.create({ data: { showtimeId: order.showtimeId, seatId: s.seatId, orderId: order.id, status: 'SOLD' } });
    }
  }

  await tx.order.update({ where: { id: order.id }, data: { status: 'PAID', paidAt: new Date() } });
  if (order.promotionId) await tx.promotion.update({ where: { id: order.promotionId }, data: { usedCount: { increment: 1 } } }); // BR-24
  const points = Math.floor(order.total / POINT_UNIT); // BR-25
  if (points > 0) await tx.user.update({ where: { id: order.userId }, data: { points: { increment: points } } });
  return true;
}

/**
 * Trạng thái giao dịch cho trang kết quả (P07) hỏi định kỳ. CHỈ ĐỌC — không bao giờ đổi trạng thái đơn.
 * @param {{ userId: string, txnRef: string }} params
 * @returns {Promise<{ orderId: string, orderStatus: string, paymentStatus: string }>}
 * @throws {AppError} NOT_FOUND (cả khi không phải chủ giao dịch, để không lộ sự tồn tại của mã)
 */
export async function getPaymentStatus({ userId, txnRef }) {
  const payment = await prisma.payment.findUnique({ where: { txnRef }, include: { order: { select: { userId: true, status: true } } } });
  if (!payment || payment.order.userId !== userId) throw new AppError('NOT_FOUND');
  return { orderId: payment.orderId, orderStatus: payment.order.status, paymentStatus: payment.status };
}

/**
 * CHỈ DÙNG KHI PHÁT TRIỂN/DEMO: giả lập VNPay gọi IPN. Tự dựng một IPN có chữ ký hợp lệ rồi đi qua
 * ĐÚNG hàm confirmPayment như IPN thật, nên kiểm thử luồng này cũng kiểm thử cả phần kiểm chữ ký.
 * @param {{ txnRef: string, result: 'SUCCESS' | 'FAILED' }} params
 */
export async function simulateIpn({ txnRef, result }) {
  requireVnpConfig();
  const payment = await prisma.payment.findUnique({ where: { txnRef } });
  if (!payment) throw new AppError('NOT_FOUND');
  const ok = result === 'SUCCESS';
  const query = {
    vnp_TmnCode: env.VNP_TMN_CODE,
    vnp_Amount: String(payment.amount * 100),
    vnp_BankCode: payment.bankCode ?? 'NCB',
    vnp_TxnRef: txnRef,
    vnp_TransactionNo: String(Date.now()),
    vnp_PayDate: formatVnpDate(new Date()),
    vnp_ResponseCode: ok ? '00' : '24', // 24 = khách hủy giao dịch
    vnp_TransactionStatus: ok ? '00' : '02',
  };
  query.vnp_SecureHash = sign(query, env.VNP_HASH_SECRET);
  return confirmPayment({ query });
}
