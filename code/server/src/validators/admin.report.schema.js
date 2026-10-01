import { z } from 'zod';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có dạng YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Ngày không hợp lệ');

// Mặc định: 30 ngày gần nhất tính đến hôm nay (giờ VN).
const vnToday = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const daysBefore = (date, n) => new Date(Date.parse(date) - n * 86_400_000).toISOString().slice(0, 10);

export const revenueQuery = z.object({
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  groupBy: z.enum(['day', 'movie', 'cinema']).default('day'),
}).transform((q) => {
  const to = q.to ?? vnToday();
  return { ...q, to, from: q.from ?? daysBefore(to, 29) };
});
