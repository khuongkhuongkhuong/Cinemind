import { z } from 'zod';

export const createOrderSchema = z.object({
  showtimeId: z.uuid('showtimeId không hợp lệ'),
  // Cho phép > 8 để service trả đúng mã SEAT_LIMIT_EXCEEDED; 50 chỉ là chặn dữ liệu rác.
  seatIds: z.array(z.uuid('seatId không hợp lệ')).min(1, 'Vui lòng chọn ít nhất 1 ghế').max(50),
});

export const orderIdParam = z.object({ id: z.uuid('id không hợp lệ') });

export const createPaymentSchema = z.object({
  bankCode: z.string().trim().max(20).optional(),
});

export const simulateSchema = z.object({
  result: z.enum(['SUCCESS', 'FAILED']),
});

export const setCombosSchema = z.object({
  // quantity 1..10 và combo hợp lệ do service kiểm (BR-20) để trả đúng details.fields.items
  items: z.array(z.object({ comboId: z.uuid('comboId không hợp lệ'), quantity: z.number() })).max(20),
});

export const applyPromotionSchema = z.object({
  code: z.string().trim().min(1, 'Vui lòng nhập mã').max(30),
});
