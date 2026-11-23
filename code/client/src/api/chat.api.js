import { api } from './axios';

const unwrap = (promise) => promise.then((res) => res.data.data);

/**
 * Gửi một tin cho trợ lý. Không có `sessionId` = mở phiên mới.
 * Trả `{ sessionId, reply: { text, pendingAction } }` (hợp đồng API mục 3.9).
 */
export const sendMessage = ({ sessionId, text }) => unwrap(api.post('/ai/chat', { ...(sessionId && { sessionId }), text }));

/**
 * Xác nhận (`approve: true`) hoặc hủy (`approve: false`) việc đang chờ. Chỉ lời bấm này của chính người dùng mới khiến server thực thi.
 * Trả `{ reply: { text, order?, paymentUrl? } }`; thất bại nghiệp vụ (ghế vừa bị lấy…) nằm trong `reply.text`, không phải lỗi HTTP.
 */
export const confirmAction = ({ sessionId, actionId, approve }) => unwrap(api.post('/ai/confirm', { sessionId, actionId, approve }));

/** Nạp lại khung chat sau khi tải lại trang: `{ sessionId, status, messages[], pendingAction }`. */
export const getChatSession = (sessionId) => unwrap(api.get(`/ai/sessions/${encodeURIComponent(sessionId)}`));

/** Đóng phiên (bắt đầu cuộc trò chuyện mới). */
export const closeChatSession = (sessionId) => unwrap(api.delete(`/ai/sessions/${encodeURIComponent(sessionId)}`));
