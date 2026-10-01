import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { normalizeTicketCode } from '../lib/code.js';
import { orderInclude, toOrderDto } from './booking.service.js';

const WINDOW_MS = 30 * 60_000; // BR-34: từ 30 phút trước đến 30 phút sau giờ bắt đầu

// Cần thêm trạng thái suất để biết suất đã bị hủy hay chưa.
const ticketInclude = {
  ...orderInclude,
  showtime: { select: { ...orderInclude.showtime.select, status: true } },
};

const findByCode = (code) =>
  prisma.order.findUnique({ where: { code: normalizeTicketCode(code) }, include: ticketInclude });

/**
 * Vé này có vào rạp được không, và nếu không thì vì sao? (hàm thuần — một chỗ duy nhất quyết định luật check-in)
 * Thứ tự kiểm tra: chưa trả tiền -> đã dùng -> suất bị hủy -> ngoài khung giờ.
 * @param {{ status: string, checkedInAt: Date|null, showtime: { startTime: Date, status: string } }} order
 * @param {Date} now
 * @returns {{ canCheckIn: true } | { canCheckIn: false, reason: 'NOT_PAID'|'ALREADY_USED'|'SHOWTIME_CANCELLED'|'TOO_EARLY'|'TOO_LATE' }}
 */
export function evaluateCheckIn(order, now) {
  if (order.status !== 'PAID') return { canCheckIn: false, reason: 'NOT_PAID' };
  if (order.checkedInAt) return { canCheckIn: false, reason: 'ALREADY_USED' };
  if (order.showtime.status !== 'OPEN') return { canCheckIn: false, reason: 'SHOWTIME_CANCELLED' };
  const delta = now.getTime() - order.showtime.startTime.getTime(); // âm = chưa tới giờ chiếu
  if (delta < -WINDOW_MS) return { canCheckIn: false, reason: 'TOO_EARLY' };
  if (delta > WINDOW_MS) return { canCheckIn: false, reason: 'TOO_LATE' };
  return { canCheckIn: true };
}

/**
 * Tra cứu vé bằng mã (UC13) để nhân viên xem trước khi cho vào.
 * @param {{ code: string, now?: Date }} params code nhận cả mã trần lẫn nội dung QR "CINEMIND:<mã>"
 * @returns {Promise<{ order: object, canCheckIn: boolean, reason?: string }>}
 * @throws {AppError} NOT_FOUND
 */
export async function lookupTicket({ code, now = new Date() }) {
  const order = await findByCode(code);
  if (!order) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy vé.' });
  return { order: toOrderDto(order), ...evaluateCheckIn(order, now) };
}

/**
 * Check-in vé (UC14): đánh dấu cả đơn đã vào rạp (BR-33: 1 QR cho cả đơn).
 * Mỗi vé chỉ dùng được MỘT lần, kể cả khi hai nhân viên quét cùng lúc: việc "đánh dấu đã dùng" là MỘT câu lệnh
 * cập nhật có điều kiện `checkedInAt IS NULL`, nên chỉ một người thắng — giống ý tưởng "để DB làm trọng tài".
 * @param {{ code: string, staffId: string, now?: Date }} params staffId lấy từ token
 * @returns {Promise<object>} `Order` có `checkedInAt`
 * @throws {AppError} NOT_FOUND | TICKET_NOT_PAID | TICKET_ALREADY_USED | CHECKIN_NOT_ALLOWED
 */
export async function checkIn({ code, staffId, now = new Date() }) {
  const order = await findByCode(code);
  if (!order) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy vé.' });

  const verdict = evaluateCheckIn(order, now);
  if (!verdict.canCheckIn) throw ticketError(verdict.reason, order);

  const { count } = await prisma.order.updateMany({
    where: { id: order.id, status: 'PAID', checkedInAt: null },
    data: { checkedInAt: now, checkedInById: staffId },
  });
  if (count === 0) {
    // Có người vừa quét trước ta: đọc lại để báo họ quét lúc nào.
    throw ticketError('ALREADY_USED', await prisma.order.findUnique({ where: { id: order.id } }));
  }
  return toOrderDto(await prisma.order.findUnique({ where: { id: order.id }, include: orderInclude }));
}

function ticketError(reason, order) {
  switch (reason) {
    case 'NOT_PAID':
      return new AppError('TICKET_NOT_PAID');
    case 'ALREADY_USED':
      return new AppError('TICKET_ALREADY_USED', {
        message: `Vé đã được sử dụng lúc ${vnTime(order.checkedInAt)}.`,
        details: { checkedInAt: order.checkedInAt },
      });
    default: // TOO_EARLY | TOO_LATE | SHOWTIME_CANCELLED
      return new AppError('CHECKIN_NOT_ALLOWED', { details: { reason } });
  }
}

/** "HH:mm" theo giờ Việt Nam cho thông báo hiển thị cho nhân viên. */
function vnTime(date) {
  const d = new Date(date.getTime() + 7 * 3600_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
