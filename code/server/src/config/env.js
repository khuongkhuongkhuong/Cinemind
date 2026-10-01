import { z } from 'zod';

// Kiểm tra biến môi trường ngay khi khởi động: thiếu/sai thì dừng luôn, không chờ tới lúc chạy mới lỗi.
const schema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  // VNPay: tạm thời tùy chọn — chưa có tài khoản sandbox ở Ngày 0
  VNP_TMN_CODE: z.string().optional(),
  VNP_HASH_SECRET: z.string().optional(),
  VNP_URL: z.string().optional(),
  VNP_RETURN_URL: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Biến môi trường không hợp lệ:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
export const env = parsed.data;
