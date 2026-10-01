import { z } from 'zod';

// Kiểm tra biến môi trường ngay khi khởi động: thiếu/sai thì dừng luôn, không chờ tới lúc chạy mới lỗi.
const bool = z.enum(['true', 'false']).default('false').transform((v) => v === 'true');

const schema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  // VNPay: tùy chọn khi phát triển (chưa có tài khoản sandbox); BẮT BUỘC ở production (xem superRefine bên dưới)
  VNP_TMN_CODE: z.string().optional(),
  VNP_HASH_SECRET: z.string().optional(),
  VNP_URL: z.string().optional(),
  VNP_RETURN_URL: z.string().optional(),
  // Cổng giả lập thanh toán (/dev/...) cho phép đánh dấu một đơn là ĐÃ TRẢ TIỀN mà không cần đăng nhập.
  // Phải được bật CÓ CHỦ ĐÍCH (mặc định tắt) và chỉ có tác dụng khi NODE_ENV=development.
  ENABLE_DEV_ROUTES: bool,
  // Số "bước nhảy" proxy tin cậy (vd 1 khi chạy sau Nginx) để req.ip là IP khách thật, không phải IP của proxy.
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).optional(),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV !== 'production') return;
  const bad = (path, message) => ctx.addIssue({ code: 'custom', path: [path], message });

  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
    if (env[key].length < 32) bad(key, 'Production cần secret tối thiểu 32 ký tự.');
    if (/doi-thanh|changeme|secret|demo/i.test(env[key])) bad(key, 'Đang dùng giá trị mẫu; hãy sinh chuỗi ngẫu nhiên thật.');
  }
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) bad('JWT_REFRESH_SECRET', 'Hai secret phải khác nhau.');
  if (env.ENABLE_DEV_ROUTES) bad('ENABLE_DEV_ROUTES', 'Cổng giả lập thanh toán không được bật ở production.');
  if (!env.CLIENT_URL.startsWith('https://')) bad('CLIENT_URL', 'Production phải dùng HTTPS (cookie refresh có cờ Secure).');
  for (const key of ['VNP_TMN_CODE', 'VNP_HASH_SECRET', 'VNP_URL', 'VNP_RETURN_URL']) {
    if (!env[key]) bad(key, 'Production bắt buộc cấu hình VNPay.');
  }
  if (env.VNP_TMN_CODE === 'DEMO0001' || /demo/i.test(env.VNP_HASH_SECRET ?? '')) bad('VNP_HASH_SECRET', 'Đang dùng mã VNPay giả của môi trường dev.');
});

/**
 * Đọc và kiểm tra cấu hình từ một object (tách riêng khỏi process.env để test được).
 * @param {Record<string, string | undefined>} source
 * @returns {import('zod').ZodSafeParseResult<z.output<typeof schema>>}
 */
export const parseEnv = (source) => schema.safeParse(source);

const parsed = parseEnv(process.env);
if (!parsed.success) {
  console.error('Biến môi trường không hợp lệ:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
export const env = parsed.data;
