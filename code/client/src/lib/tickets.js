// Hàm thuần liên quan tới vé / đơn hàng (dễ test).

/**
 * Chuẩn hóa mã vé người dùng nhập hoặc máy quét QR trả về: nhận mã trần ("K7Q2M9XA"), mã có gạch ("K7Q2-M9XA"),
 * và nội dung QR ("CINEMIND:K7Q2M9XA"); không phân biệt hoa/thường, bỏ khoảng trắng và dấu gạch.
 */
export function normalizeTicketCode(input) {
  return String(input ?? '').trim().replace(/^cinemind:/i, '').replace(/[\s-]/g, '').toUpperCase();
}

/** "K7Q2M9XA" -> "K7Q2-M9XA" (dễ đọc, dễ đọc to cho nhân viên). */
export const formatTicketCode = (code) => (code && code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code ?? '');

const STATUS = {
  PENDING: { label: 'Chờ thanh toán', tone: 'warn' },
  PAID: { label: 'Đã thanh toán', tone: 'ok' },
  CANCELLED: { label: 'Đã hủy', tone: 'muted' },
  EXPIRED: { label: 'Hết hạn giữ ghế', tone: 'muted' },
  REFUND_PENDING: { label: 'Chờ hoàn tiền', tone: 'warn' },
  REFUNDED: { label: 'Đã hoàn tiền', tone: 'muted' },
};
export const orderStatusInfo = (status) => STATUS[status] ?? { label: status, tone: 'muted' };

/**
 * Trạng thái sử dụng của một vé ĐÃ THANH TOÁN: đã dùng / suất đã chiếu xong / chưa sử dụng.
 * Chỉ mang tính hiển thị; việc cho vào rạp do nhân viên + server quyết định.
 * @param {{ status: string, checkedInAt?: string|null, showtime: { startTime: string, endTime?: string } }} order
 * @param {number} [now]
 * @returns {'USED' | 'PAST' | 'UPCOMING' | null} null nếu đơn chưa thanh toán
 */
export function ticketUsage(order, now = Date.now()) {
  if (order.status !== 'PAID') return null;
  if (order.checkedInAt) return 'USED';
  return Date.parse(order.showtime.startTime) + 60 * 60_000 < now ? 'PAST' : 'UPCOMING';
}

/** Lý do tra cứu vé không cho check-in -> câu hiển thị cho nhân viên (S01). */
export const CHECKIN_REASONS = {
  NOT_PAID: 'Vé chưa thanh toán hoặc đã bị hủy / hoàn tiền.',
  ALREADY_USED: 'Vé đã được sử dụng.',
  TOO_EARLY: 'Chưa tới giờ check-in (mở trước giờ chiếu 30 phút).',
  TOO_LATE: 'Đã quá giờ check-in (đóng sau giờ chiếu 30 phút).',
  SHOWTIME_CANCELLED: 'Suất chiếu này đã bị hủy.',
};
export const checkInReasonText = (reason) => CHECKIN_REASONS[reason] ?? 'Vé không hợp lệ để vào rạp.';
