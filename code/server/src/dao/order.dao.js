import { prisma } from '../config/prisma.js';

/**
 * Hình dạng "đơn đầy đủ" mà các màn hình đọc (đơn, vé, soát vé, quản trị). Nằm ở DAO vì đây là CÁCH ĐỌC dữ liệu,
 * không phải luật nghiệp vụ; service chỉ việc đổi nó sang `Order` DTO (booking.service.toOrderDto).
 */
export const ORDER_INCLUDE = {
  showtime: {
    select: {
      id: true, startTime: true, format: true, audio: true,
      movie: { select: { title: true, ageRating: true, posterUrl: true } },
      room: { select: { name: true, cinema: { select: { name: true } } } },
    },
  },
  seats: { orderBy: { seatLabel: 'asc' } },
  combos: { include: { combo: { select: { name: true } } }, orderBy: { combo: { name: 'asc' } } },
  promotion: { select: { code: true, name: true } },
};

// Soát vé cần thêm trạng thái suất để biết suất đã bị hủy hay chưa.
const TICKET_INCLUDE = {
  ...ORDER_INCLUDE,
  showtime: { select: { ...ORDER_INCLUDE.showtime.select, status: true } },
};

/**
 * Tìm đơn theo MÃ (đã chuẩn hóa) kèm dữ liệu cho soát vé (gồm trạng thái suất).
 * @param {string} code mã đơn / vé, đã qua normalizeTicketCode
 * @returns {Promise<object|null>}
 */
export const findOrderByCode = (code, db = prisma) => db.order.findUnique({ where: { code }, include: TICKET_INCLUDE });

/** Đơn thô (không kèm quan hệ). @returns {Promise<object|null>} */
export const getOrderById = (orderId, db = prisma) => db.order.findUnique({ where: { id: orderId } });

/** Đơn đầy đủ theo `ORDER_INCLUDE`. @returns {Promise<object|null>} */
export const getOrderDetail = (orderId, db = prisma) => db.order.findUnique({ where: { id: orderId }, include: ORDER_INCLUDE });

/**
 * Số đơn "đã chiếm chỗ" của suất: đã thanh toán, chờ hoàn tiền, hoặc đang chờ thanh toán còn hạn giữ ghế.
 * Có thì suất không được sửa / hủy.
 * @returns {Promise<number>}
 */
export const countActiveSalesOfShowtime = ({ showtimeId, now }, db = prisma) =>
  db.order.count({
    where: {
      showtimeId,
      OR: [{ status: { in: ['PAID', 'REFUND_PENDING'] } }, { status: 'PENDING', expiresAt: { gt: now } }],
    },
  });

/**
 * ⭐ Đánh dấu đơn ĐÃ VÀO RẠP — MỘT câu cập nhật có điều kiện (`status = PAID` và `checkedInAt IS NULL`): hai nhân viên quét
 * cùng lúc thì chỉ một người có count = 1. Service quyết định nghĩa của count = 0 (có người quét trước).
 * @param {{ orderId: string, staffId: string, now: Date }} params
 * @returns {Promise<number>} 1 nếu vừa check-in được, 0 nếu không
 */
export const checkInIfNotUsed = async ({ orderId, staffId, now }, db = prisma) =>
  (await db.order.updateMany({
    where: { id: orderId, status: 'PAID', checkedInAt: null },
    data: { checkedInAt: now, checkedInById: staffId },
  })).count;
