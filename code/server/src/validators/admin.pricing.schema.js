import { z } from 'zod';

const price = z.number().int('Giá phải là số nguyên (VND)').min(0).max(5_000_000);
const FORMATS = ['F2D', 'F3D', 'IMAX'];
const DAY_TYPES = ['WEEKDAY', 'WEEKEND'];
const SEAT_TYPES = ['STANDARD', 'VIP', 'COUPLE'];

// Bắt buộc ĐỦ mọi ô, mỗi ô đúng một lần: thiếu ô nào thì tạo suất ở định dạng/loại ngày đó sẽ không tra được giá.
export const pricingSchema = z.object({
  priceRules: z.array(z.object({
    format: z.enum(FORMATS), dayType: z.enum(DAY_TYPES), basePrice: price,
  }).strict()).refine(
    (rules) => rules.length === FORMATS.length * DAY_TYPES.length
      && FORMATS.every((f) => DAY_TYPES.every((d) => rules.filter((r) => r.format === f && r.dayType === d).length === 1)),
    { message: 'Cần đủ 6 giá gốc: mỗi định dạng (F2D, F3D, IMAX) × loại ngày (WEEKDAY, WEEKEND) đúng một lần.' },
  ),
  surcharges: z.array(z.object({ seatType: z.enum(SEAT_TYPES), surcharge: price }).strict()).refine(
    (list) => list.length === SEAT_TYPES.length && SEAT_TYPES.every((t) => list.filter((s) => s.seatType === t).length === 1),
    { message: 'Cần đủ 3 phụ thu: STANDARD, VIP, COUPLE mỗi loại đúng một lần.' },
  ),
}).strict();
