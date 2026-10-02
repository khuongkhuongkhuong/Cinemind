/**
 * Chuẩn hóa mọi lỗi thành { status, code, message, details }.
 * Giao diện rẽ nhánh theo `code`, KHÔNG theo `message` (hợp đồng API mục 1.1): message chỉ để hiển thị.
 */
export function normalizeError(error) {
  const body = error?.response?.data;
  if (body && body.success === false && body.error) {
    return { status: error.response.status, code: body.error.code, message: body.error.message, details: body.error.details };
  }
  if (error?.response) {
    return { status: error.response.status, code: 'HTTP_ERROR', message: 'Có lỗi xảy ra, vui lòng thử lại.' };
  }
  if (error?.code === 'ERR_CANCELED') return { status: 0, code: 'CANCELED', message: 'Yêu cầu đã bị hủy.' };
  return { status: 0, code: 'NETWORK_ERROR', message: 'Không kết nối được máy chủ. Vui lòng kiểm tra mạng và thử lại.' };
}

/** Thông báo hiển thị cho người dùng (kèm gợi ý riêng cho một số mã hay gặp). */
export function errorMessage(error) {
  const e = normalizeError(error);
  if (e.code === 'RATE_LIMITED') return 'Bạn thao tác quá nhiều lần, vui lòng thử lại sau ít phút.';
  return e.message;
}

/** Lỗi này có đúng mã `code` không? Dùng: if (hasCode(err, 'SEAT_UNAVAILABLE')) ... */
export const hasCode = (error, code) => normalizeError(error).code === code;

/** Lỗi theo từng ô nhập (400 VALIDATION_ERROR có details.fields): { email: 'Email không hợp lệ' }, hoặc {} nếu không có. */
export const fieldErrors = (error) => normalizeError(error).details?.fields ?? {};
