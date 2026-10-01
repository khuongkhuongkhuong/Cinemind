import { prisma } from '../config/prisma.js';

const FORMATS = ['F2D', 'F3D', 'IMAX'];
const DAY_TYPES = ['WEEKDAY', 'WEEKEND'];
const SEAT_TYPES = ['STANDARD', 'VIP', 'COUPLE'];

/**
 * Bảng giá hiện hành (BR-12, BR-13): giá gốc theo (định dạng × loại ngày) và phụ thu theo loại ghế, xếp thứ tự cố định.
 * @param {object} [db] prisma hoặc `tx` trong transaction
 * @returns {Promise<{ priceRules: Array<{ format: string, dayType: string, basePrice: number }>, surcharges: Array<{ seatType: string, surcharge: number }> }>}
 */
export async function getPricing(db = prisma) {
  const [rules, surcharges] = await Promise.all([db.priceRule.findMany(), db.seatTypeSurcharge.findMany()]);
  return {
    priceRules: FORMATS.flatMap((format) => DAY_TYPES.map((dayType) => {
      const r = rules.find((x) => x.format === format && x.dayType === dayType);
      return { format, dayType, basePrice: r?.basePrice ?? null };
    })),
    surcharges: SEAT_TYPES.map((seatType) => ({ seatType, surcharge: surcharges.find((x) => x.seatType === seatType)?.surcharge ?? null })),
  };
}

/**
 * Ghi toàn bộ bảng giá bằng `tx` (tách riêng khỏi setPricing để test được trong transaction rồi rollback — bảng giá là dữ liệu
 * dùng chung nên test không được sửa thật).
 * @param {object} tx
 * @param {{ priceRules: Array<{ format: string, dayType: string, basePrice: number }>, surcharges: Array<{ seatType: string, surcharge: number }> }} data
 */
export async function applyPricing(tx, { priceRules, surcharges }) {
  for (const { format, dayType, basePrice } of priceRules) {
    await tx.priceRule.upsert({ where: { format_dayType: { format, dayType } }, update: { basePrice }, create: { format, dayType, basePrice } });
  }
  for (const { seatType, surcharge } of surcharges) {
    await tx.seatTypeSurcharge.upsert({ where: { seatType }, update: { surcharge }, create: { seatType, surcharge } });
  }
}

/**
 * Cập nhật TOÀN BỘ bảng giá trong một transaction (đủ 6 giá gốc + 3 phụ thu — validator đã bảo đảm không thiếu ô nào,
 * vì thiếu một ô thì tạo suất chiếu ở định dạng/loại ngày đó sẽ không tra được giá). Hoặc cả bảng đổi, hoặc không gì đổi.
 *
 * Phạm vi ảnh hưởng (đúng BR-14): suất chiếu ĐÃ TẠO giữ nguyên `basePrice` (đã chốt lúc tạo) và đơn đã tạo giữ nguyên giá;
 * giá gốc mới chỉ áp cho suất tạo MỚI. Riêng phụ thu loại ghế được đọc lúc giữ ghế nên áp cho đơn MỚI trên mọi suất.
 * @param {{ priceRules: Array<object>, surcharges: Array<object> }} params
 * @returns {Promise<object>} bảng giá sau khi cập nhật
 */
export async function setPricing(data) {
  await prisma.$transaction((tx) => applyPricing(tx, data));
  return getPricing();
}
