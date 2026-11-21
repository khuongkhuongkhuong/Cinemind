import { prisma } from '../config/prisma.js';

/** Số giao dịch đã tạo cho đơn (để đặt `txnRef` = <mã đơn>-<lần thứ n>). */
export const countPaymentsOfOrder = (orderId, db = prisma) => db.payment.count({ where: { orderId } });

/**
 * Tạo giao dịch ở trạng thái PENDING. `txnRef` là UNIQUE: trùng thì lỗi Prisma P2002 đi xuyên DAO và service thử số kế tiếp.
 * @param {{ orderId: string, txnRef: string, amount: number, bankCode: string|null }} data
 */
export const insertPayment = ({ orderId, txnRef, amount, bankCode }, db = prisma) => db.payment.create({ data: { orderId, txnRef, amount, bankCode } });

/** @returns {Promise<object|null>} Payment theo mã giao dịch của VNPay (`vnp_TxnRef`) */
export const findPaymentByTxnRef = (txnRef, db = prisma) => db.payment.findUnique({ where: { txnRef } });

/**
 * ⭐ Ghi nhận THẤT BẠI NẾU giao dịch còn PENDING — một câu cập nhật có điều kiện.
 * @param {{ id: string, fields: { responseCode: string|null, providerTxnNo: string|null, rawData: object } }} params
 * @returns {Promise<number>} 1 nếu vừa ghi được, 0 nếu giao dịch đã được xử lý trước đó
 */
export const markPaymentFailedIfPending = async ({ id, fields }, db = prisma) =>
  (await db.payment.updateMany({
    where: { id, status: 'PENDING' },
    data: { status: 'FAILED', responseCode: fields.responseCode, providerTxnNo: fields.providerTxnNo, rawData: fields.rawData },
  })).count;

/**
 * ⭐ "GIÀNH" giao dịch: PENDING -> SUCCESS trong MỘT câu cập nhật có điều kiện. Hai IPN trùng nhau chạy cùng lúc: câu thứ hai
 * bị chặn chờ câu đầu commit rồi thấy status đã SUCCESS => count = 0 => dừng. Đây là cơ chế IDEMPOTENT của IPN.
 * @param {{ id: string, paidAt: Date, fields: { responseCode: string|null, providerTxnNo: string|null, bankCode?: string, rawData: object } }} params
 * @returns {Promise<number>} 1 nếu giành được, 0 nếu IPN khác đã xử lý
 */
export const claimPaymentSuccess = async ({ id, paidAt, fields }, db = prisma) =>
  (await db.payment.updateMany({
    where: { id, status: 'PENDING' },
    data: {
      status: 'SUCCESS', responseCode: fields.responseCode, providerTxnNo: fields.providerTxnNo, bankCode: fields.bankCode, paidAt, rawData: fields.rawData,
    },
  })).count;
