import { z } from 'zod';

export const idParam = z.object({ id: z.uuid('id không hợp lệ') });

// Chỉ http/https: chặn "javascript:..." / "data:..." chui vào ảnh rồi bị hiển thị cho khách (XSS).
const httpUrl = z.url({ protocol: /^https?$/, message: 'URL phải bắt đầu bằng http:// hoặc https://' }).max(500);
const isoDate = z.iso.datetime({ message: 'Phải là thời điểm ISO 8601 (ví dụ 2026-10-05T00:00:00.000Z)' }).transform((s) => new Date(s));

// ---------- Thể loại ----------
export const genreSchema = z.object({ name: z.string().trim().min(1, 'Vui lòng nhập tên thể loại').max(50) }).strict();

// ---------- Combo ----------
const comboFields = {
  name: z.string().trim().min(1, 'Vui lòng nhập tên combo').max(100),
  description: z.string().trim().max(300).nullable(),
  price: z.number().int('Giá phải là số nguyên (VND)').min(0).max(10_000_000),
  imageUrl: httpUrl.nullable(),
  isActive: z.boolean(),
};
export const createComboSchema = z.object({
  name: comboFields.name, price: comboFields.price,
  description: comboFields.description.optional(), imageUrl: comboFields.imageUrl.optional(), isActive: comboFields.isActive.optional(),
}).strict();
export const updateComboSchema = z.object(
  Object.fromEntries(Object.entries(comboFields).map(([k, v]) => [k, v.optional()])),
).strict().refine((v) => Object.keys(v).length > 0, { message: 'Cần ít nhất một trường để sửa.' });

// ---------- Khuyến mãi ----------
// Mã: viết hoa, chỉ chữ/số/gạch (khách gõ vào ô nhập nên phải đơn giản, không dấu cách).
const code = z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,30}$/, 'Mã gồm 3–30 ký tự chữ, số, "-" hoặc "_"');
const promoFields = {
  name: z.string().trim().min(1, 'Vui lòng nhập tên').max(100),
  description: z.string().trim().max(300).nullable(),
  discountType: z.enum(['PERCENT', 'FIXED']),
  discountValue: z.number().int().min(1).max(100_000_000),
  maxDiscount: z.number().int().min(1).max(100_000_000).nullable(),
  minOrderValue: z.number().int().min(0).max(100_000_000),
  startAt: isoDate,
  endAt: isoDate,
  usageLimit: z.number().int().min(1).max(10_000_000).nullable(),
  isActive: z.boolean(),
};
export const createPromotionSchema = z.object({
  code,
  name: promoFields.name,
  discountType: promoFields.discountType,
  discountValue: promoFields.discountValue,
  startAt: promoFields.startAt,
  endAt: promoFields.endAt,
  description: promoFields.description.optional(),
  maxDiscount: promoFields.maxDiscount.optional(),
  minOrderValue: promoFields.minOrderValue.optional(),
  usageLimit: promoFields.usageLimit.optional(),
  isActive: promoFields.isActive.optional(),
}).strict();
// Không có `code` và `usedCount` ở đây: .strict() sẽ từ chối nếu client gửi.
export const updatePromotionSchema = z.object(
  Object.fromEntries(Object.entries(promoFields).map(([k, v]) => [k, v.optional()])),
).strict().refine((v) => Object.keys(v).length > 0, { message: 'Cần ít nhất một trường để sửa.' });
