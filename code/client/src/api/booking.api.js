import { api } from './axios';

// Mọi hàm trả về `data` của response chuẩn { success, data } (hợp đồng API mục 1.1 và 2.3).
const unwrap = (promise) => promise.then((res) => res.data.data);

/** Sơ đồ ghế một suất kèm trạng thái và giá từng ghế (mẫu 3.3). */
export const getSeatMap = (showtimeId) => unwrap(api.get(`/showtimes/${showtimeId}/seats`));

/** Giữ ghế và tạo đơn PENDING (10 phút). Lỗi chính: SEAT_UNAVAILABLE, SEAT_LIMIT_EXCEEDED, COUPLE_SEAT_INCOMPLETE, SHOWTIME_CLOSED. */
export const createOrder = ({ showtimeId, seatIds }) => unwrap(api.post('/orders', { showtimeId, seatIds }));

export const getOrder = (orderId) => unwrap(api.get(`/orders/${orderId}`));

/** THAY CẢ danh sách combo của đơn (`[]` = bỏ hết). Server trả đơn với tổng tiền mới. */
export const setCombos = (orderId, items) => unwrap(api.put(`/orders/${orderId}/combos`, { items }));

export const applyPromotion = (orderId, code) => unwrap(api.post(`/orders/${orderId}/promotion`, { code }));
export const removePromotion = (orderId) => unwrap(api.delete(`/orders/${orderId}/promotion`));
export const cancelOrder = (orderId) => unwrap(api.post(`/orders/${orderId}/cancel`));

/** Tạo giao dịch thanh toán: trả { paymentId, txnRef, paymentUrl, expiresAt }. Mỗi lần gọi là một giao dịch MỚI. */
export const createPayment = (orderId) => unwrap(api.post(`/orders/${orderId}/payments`, {}));

/** Trạng thái giao dịch cho trang kết quả: { orderId, orderStatus, paymentStatus }. CHỈ ĐỌC. */
export const getPaymentStatus = (txnRef) => unwrap(api.get(`/payments/${encodeURIComponent(txnRef)}/status`));

export const listCombos = () => unwrap(api.get('/combos'));

/** CHỈ DÙNG KHI PHÁT TRIỂN: giả lập VNPay gọi IPN (backend phải bật ENABLE_DEV_ROUTES). */
export const simulatePayment = (txnRef, result = 'SUCCESS') => api.post(`/dev/payments/${encodeURIComponent(txnRef)}/simulate`, { result }).then((res) => res.data);
