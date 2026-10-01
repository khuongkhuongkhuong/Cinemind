import { AppError } from '../utils/AppError.js';
import { fail } from '../utils/response.js';
import { ERROR_CODES } from '../utils/errorCodes.js';

export function notFoundHandler(req, res) {
  fail(res, { status: 404, code: 'NOT_FOUND', message: `Không tìm thấy ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars -- Express nhận diện error handler qua đúng 4 tham số
export function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return fail(res, { status: err.status, code: err.code, message: err.message, details: err.details });
  }
  // JSON body hỏng
  if (err.type === 'entity.parse.failed') {
    return fail(res, { status: 400, code: 'VALIDATION_ERROR', message: 'JSON không hợp lệ.' });
  }
  // Lỗi do CLIENT gây ra mà thư viện (body-parser, router...) đã gán mã 4xx: body quá lớn (413), %xx hỏng trong URL (400)...
  // Không phải lỗi hệ thống nên không trả 500 và không ghi log lỗi.
  if (Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
    const message = err.status === 413 ? 'Dữ liệu gửi lên quá lớn.' : 'Yêu cầu không hợp lệ.';
    return fail(res, { status: err.status, code: 'VALIDATION_ERROR', message });
  }
  // Lỗi không lường trước: log đầy đủ ở server, KHÔNG lộ chi tiết kỹ thuật cho client.
  console.error(err);
  const def = ERROR_CODES.INTERNAL_ERROR;
  fail(res, { status: def.status, code: 'INTERNAL_ERROR', message: def.message });
}
