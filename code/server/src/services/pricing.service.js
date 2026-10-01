import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { vnWeekday } from '../lib/time.js';

/**
 * Loại ngày của một suất chiếu theo giờ Việt Nam (BR-12): T6–CN = WEEKEND, còn lại WEEKDAY.
 * MVP chưa xử lý ngày lễ.
 * @param {{ startTime: Date }} params
 * @returns {'WEEKDAY' | 'WEEKEND'}
 */
export function getDayType({ startTime }) {
  const dow = vnWeekday(startTime);
  return dow === 0 || dow === 5 || dow === 6 ? 'WEEKEND' : 'WEEKDAY';
}

/**
 * Giá gốc của suất chiếu, tra từ bảng PriceRule theo định dạng + loại ngày (BR-12).
 * Dùng khi admin tạo suất mà không gửi `basePrice`.
 * @param {{ format: 'F2D' | 'F3D' | 'IMAX', startTime: Date }} params
 * @returns {Promise<{ basePrice: number, dayType: string }>}
 */
export async function getBasePrice({ format, startTime }) {
  const dayType = getDayType({ startTime });
  const rule = await prisma.priceRule.findUnique({ where: { format_dayType: { format, dayType } } });
  if (!rule) throw new AppError('NOT_FOUND', { message: `Chưa có bảng giá cho ${format} / ${dayType}.` });
  return { basePrice: rule.basePrice, dayType };
}

/**
 * Bảng phụ thu theo loại ghế, ví dụ { STANDARD: 0, VIP: 15000, COUPLE: 20000 }.
 * @returns {Promise<Record<'STANDARD' | 'VIP' | 'COUPLE', number>>}
 */
export async function getSurcharges() {
  const rows = await prisma.seatTypeSurcharge.findMany();
  return Object.fromEntries(rows.map((r) => [r.seatType, r.surcharge]));
}

/**
 * Tính giá từng ghế (hàm thuần — không đụng DB, dễ test).
 * - STANDARD / VIP (BR-11): giá = giá gốc + phụ thu.
 * - COUPLE (BR-13): giá cả cặp = giá gốc × 2 + phụ thu đôi; mỗi ghế trong đơn lưu MỘT NỬA giá cặp
 *   (để tổng các ghế luôn bằng đúng giá cặp). Ghế lẻ trong cặp nhận phần dư (không làm tròn mất tiền).
 * Điều kiện: ghế đôi phải đủ cặp (BR-05) — kiểm tra ở booking.service trước khi gọi hàm này.
 *
 * @param {{
 *   basePrice: number,
 *   surcharges: Record<string, number>,
 *   seats: Array<{ id: string, type: 'STANDARD' | 'VIP' | 'COUPLE', pairCode?: string | null }>
 * }} params
 * @returns {{ seats: Array<{ id: string, price: number, pairPrice?: number }>, total: number }}
 *   `pairPrice` (chỉ ghế đôi) = giá cả cặp, để sơ đồ ghế hiển thị.
 */
export function calcSeatPrices({ basePrice, surcharges, seats }) {
  const coupleCount = {}; // pairCode -> số ghế đã gặp, để chia nửa giá cho từng ghế
  const priced = seats.map((seat) => {
    if (seat.type !== 'COUPLE') {
      return { id: seat.id, price: basePrice + (surcharges[seat.type] ?? 0) };
    }
    const pairPrice = basePrice * 2 + (surcharges.COUPLE ?? 0);
    const seen = (coupleCount[seat.pairCode] = (coupleCount[seat.pairCode] ?? 0) + 1);
    const half = Math.floor(pairPrice / 2);
    return { id: seat.id, price: seen === 1 ? half : pairPrice - half, pairPrice };
  });
  return { seats: priced, total: priced.reduce((sum, s) => sum + s.price, 0) };
}
