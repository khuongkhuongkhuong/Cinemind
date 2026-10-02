import { safeExternalUrl } from './movies';

/**
 * Chuyển hẳn sang trang thanh toán của cổng (VNPay). Tách thành hàm riêng để test thay thế được (jsdom không điều hướng thật).
 * Chỉ nhận http(s): link thanh toán do server tạo, nhưng vẫn không chuyển hướng tới scheme lạ.
 * @returns {boolean} false nếu URL không hợp lệ (không điều hướng)
 */
export function goToGateway(url) {
  const safe = safeExternalUrl(url);
  if (!safe) return false;
  window.location.assign(safe);
  return true;
}

/**
 * Cổng giả lập thanh toán của giao diện (khi chưa có tài khoản VNPay): CHỈ chạy ở chế độ dev VÀ khi đặt VITE_PAYMENT_SIMULATOR=true.
 * Bản build triển khai (import.meta.env.DEV = false) không bao giờ dùng.
 */
export const paymentSimulatorEnabled = () => import.meta.env.DEV && import.meta.env.VITE_PAYMENT_SIMULATOR === 'true';
