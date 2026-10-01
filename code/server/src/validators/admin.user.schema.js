import { z } from 'zod';
import { paginationShape } from '../utils/pagination.js';

const email = z.string().trim().toLowerCase().pipe(z.email('Email không hợp lệ'));

export const adminUsersQuery = z.object({
  q: z.string().trim().max(100).optional(),
  role: z.enum(['USER', 'STAFF', 'ADMIN']).optional(),
  ...paginationShape,
});

// .strict(): không nhận `role` ở đây — tạo tài khoản qua API này luôn là STAFF.
export const createStaffSchema = z.object({
  email,
  password: z.string().min(8, 'Mật khẩu tối thiểu 8 ký tự').max(72, 'Mật khẩu tối đa 72 ký tự'),
  fullName: z.string().trim().min(1, 'Vui lòng nhập họ tên').max(100),
  phone: z.string().trim().regex(/^0\d{9}$/, 'Số điện thoại không hợp lệ').optional(),
}).strict();

export const updateUserSchema = z.object({
  role: z.enum(['USER', 'STAFF', 'ADMIN']).optional(),
  isActive: z.boolean().optional(),
}).strict().refine((v) => Object.keys(v).length > 0, { message: 'Cần ít nhất một trường để sửa.' });

export const userIdParam = z.object({ id: z.uuid('id không hợp lệ') });
