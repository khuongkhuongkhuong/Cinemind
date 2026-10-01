import { z } from 'zod';

const email = z.string().trim().toLowerCase().pipe(z.email('Email không hợp lệ'));

export const registerSchema = z.object({
  email,
  password: z.string().min(8, 'Mật khẩu tối thiểu 8 ký tự').max(72, 'Mật khẩu tối đa 72 ký tự'), // bcrypt chỉ đọc 72 byte
  fullName: z.string().trim().min(1, 'Vui lòng nhập họ tên').max(100),
  phone: z.string().trim().regex(/^0\d{9}$/, 'Số điện thoại không hợp lệ').optional(),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Vui lòng nhập mật khẩu'),
});
