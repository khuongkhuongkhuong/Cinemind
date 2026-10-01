import { z } from 'zod';
import { paginationShape } from '../utils/pagination.js';

export const myOrdersQuery = z.object({
  status: z.enum(['PENDING', 'PAID', 'CANCELLED', 'EXPIRED', 'REFUND_PENDING', 'REFUNDED']).optional(),
  ...paginationShape,
});

export const codeParam = z.object({ code: z.string().trim().min(4).max(20) });

// .strict(): trường lạ (role, email, points...) bị TỪ CHỐI, không lặng lẽ bỏ qua — chống tự nâng quyền (mass assignment).
export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(1, 'Vui lòng nhập họ tên').max(100).optional(),
  phone: z.string().trim().regex(/^0\d{9}$/, 'Số điện thoại không hợp lệ').nullable().optional(),
}).strict().refine((v) => Object.keys(v).length > 0, { message: 'Cần ít nhất một trường để sửa.' });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Vui lòng nhập mật khẩu hiện tại'),
  newPassword: z.string().min(8, 'Mật khẩu mới tối thiểu 8 ký tự').max(72, 'Mật khẩu mới tối đa 72 ký tự'),
}).strict();
