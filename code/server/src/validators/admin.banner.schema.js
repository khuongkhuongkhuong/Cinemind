import { z } from 'zod';

const SITE_PATH = /^\/(?!\/)[A-Za-z0-9\-._~%/?=&#]*$/;

/**
 * URL an toàn để hiển thị / chuyển hướng: hoặc http(s)://..., hoặc đường dẫn nội bộ của chính trang ("/banners/a.jpg").
 * Cấm "//evil.com" (theo giao thức hiện tại, sẽ dẫn ra trang lạ — open redirect) và mọi scheme khác như "javascript:" (XSS).
 */
function isSafeUrl(value) {
  if (SITE_PATH.test(value)) return true;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
const url = z.string().trim().max(500).refine(isSafeUrl, 'Phải là URL http(s):// hoặc đường dẫn nội bộ bắt đầu bằng "/".');
const isoDate = z.iso.datetime({ message: 'Phải là thời điểm ISO 8601' }).transform((s) => new Date(s));

const fields = {
  title: z.string().trim().min(1, 'Vui lòng nhập tiêu đề').max(150),
  imageUrl: url,
  linkUrl: url.nullable(),
  sortOrder: z.number().int().min(0).max(10_000),
  isActive: z.boolean(),
  startAt: isoDate.nullable(),
  endAt: isoDate.nullable(),
};

export const createBannerSchema = z.object({
  title: fields.title,
  imageUrl: fields.imageUrl,
  linkUrl: fields.linkUrl.optional(),
  sortOrder: fields.sortOrder.optional(),
  isActive: fields.isActive.optional(),
  startAt: fields.startAt.optional(),
  endAt: fields.endAt.optional(),
}).strict();

export const updateBannerSchema = z.object(
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()])),
).strict().refine((v) => Object.keys(v).length > 0, { message: 'Cần ít nhất một trường để sửa.' });

export const bannerIdParam = z.object({ id: z.uuid('id không hợp lệ') });
