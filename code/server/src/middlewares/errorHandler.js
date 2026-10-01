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
  // Lỗi không lường trước: log đầy đủ ở server, KHÔNG lộ chi tiết kỹ thuật cho client.
  console.error(err);
  const def = ERROR_CODES.INTERNAL_ERROR;
  fail(res, { status: def.status, code: 'INTERNAL_ERROR', message: def.message });
}
