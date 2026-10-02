// Access token CHỈ nằm trong bộ nhớ (biến này), không ghi vào localStorage/sessionStorage:
// mã độc chạy trên trang (XSS) không đọc được nó từ kho lưu trữ. Refresh token nằm trong cookie httpOnly do server quản lý.
let accessToken = null;
const expiredListeners = new Set();

export const getAccessToken = () => accessToken;
export const setAccessToken = (token) => { accessToken = token; };

/** Đăng ký hàm được gọi khi phiên đăng nhập hết hiệu lực hẳn (refresh thất bại). Trả về hàm hủy đăng ký. */
export function onSessionExpired(listener) {
  expiredListeners.add(listener);
  return () => expiredListeners.delete(listener);
}
export const emitSessionExpired = () => expiredListeners.forEach((fn) => fn());

// "Dấu hiệu đã đăng nhập": CHỈ là một cờ true/false, KHÔNG chứa token hay thông tin gì. Cookie refresh là httpOnly nên JavaScript
// không biết nó có tồn tại không; nếu cứ thử refresh khi mở trang thì khách chưa từng đăng nhập nào cũng gây một lỗi 401 đỏ trong console.
// Có cờ này thì mới thử khôi phục phiên. Cờ bị xóa khi đăng xuất hoặc khi phiên hết hạn.
const HINT_KEY = 'cinemind:session';

export function hasSessionHint() {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return true; // không đọc được kho lưu trữ (chế độ riêng tư): cứ thử, mất thêm một request còn hơn bắt người dùng đăng nhập lại
  }
}

export function setSessionHint(on) {
  try {
    if (on) localStorage.setItem(HINT_KEY, '1');
    else localStorage.removeItem(HINT_KEY);
  } catch { /* bỏ qua: chỉ là gợi ý */ }
}
