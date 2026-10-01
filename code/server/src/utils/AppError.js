import { ERROR_CODES } from './errorCodes.js';

/**
 * Lỗi nghiệp vụ có chủ đích. Service chỉ cần: throw new AppError('SEAT_UNAVAILABLE', { details })
 * @param {keyof typeof ERROR_CODES} code
 * @param {{ message?: string, details?: object }} [options]
 */
export class AppError extends Error {
  constructor(code, { message, details } = {}) {
    const def = ERROR_CODES[code];
    if (!def) throw new Error(`Mã lỗi chưa khai báo: ${code}`);
    super(message ?? def.message);
    this.code = code;
    this.status = def.status;
    this.details = details;
  }
}
