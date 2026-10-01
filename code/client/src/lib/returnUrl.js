/**
 * Chỉ cho phép quay lại một đường dẫn NỘI BỘ sau khi đăng nhập. Nếu tin `returnUrl` trên URL một cách mù quáng,
 * kẻ xấu gửi link `/login?returnUrl=https://trang-gia-mao.com` (hoặc `//trang-gia-mao.com`) để chuyển nạn nhân sang
 * trang giả mạo ngay sau khi họ đăng nhập thật (open redirect).
 * @param {string | null | undefined} raw
 * @param {string} [fallback]
 * @returns {string} đường dẫn nội bộ an toàn, hoặc `fallback`
 */
export function safeReturnUrl(raw, fallback = '/') {
  if (typeof raw !== 'string') return fallback;
  const url = raw.trim();
  const isLocalPath = url.startsWith('/') && !url.startsWith('//') && !url.includes('\\') && !/[\u0000-\u001f]/.test(url);
  if (!isLocalPath) return fallback;
  if (/^\/(login|register)(\/|\?|#|$)/.test(url)) return fallback; // tránh vòng lặp đăng nhập
  return url;
}

/** Đường dẫn trang đăng nhập kèm nơi sẽ quay lại. */
export const loginUrl = (returnTo) => `/login?returnUrl=${encodeURIComponent(returnTo)}`;
