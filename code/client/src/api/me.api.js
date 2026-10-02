import { api } from './axios';

const unwrap = (promise) => promise.then((res) => res.data.data);

/** "Vé của tôi": danh sách đơn của chính mình theo trạng thái (mặc định PAID), mới nhất trước. Trả { items, meta }. */
export const listMyOrders = (params = {}) => api.get('/me/orders', { params }).then((res) => ({ items: res.data.data, meta: res.data.meta }));

/** Chi tiết một đơn / vé theo MÃ ĐƠN, kèm `qrContent` (chỉ khi đã thanh toán). */
export const getMyTicket = (code) => unwrap(api.get(`/me/orders/${encodeURIComponent(code)}`));

/** Sửa họ tên / số điện thoại (`phone: null` để xóa). Trả user mới. */
export const updateProfile = (body) => unwrap(api.patch('/me/profile', body));

/** Đổi mật khẩu. Server thu hồi mọi refresh token cũ và cấp cookie mới cho thiết bị này. */
export const changePassword = (body) => api.put('/me/password', body).then(() => undefined);
