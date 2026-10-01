import { AppError } from '../utils/AppError.js';

/**
 * Kiểm tra req.body (hoặc 'query') bằng schema zod. Sai -> 400 VALIDATION_ERROR kèm details.fields
 * { tenTruong: 'thông báo' } đúng 04-api-contract mục 1.2. Dữ liệu hợp lệ đã được làm sạch ghi đè lại.
 */
export const validate = (schema, source = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    const fields = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      fields[key] ??= issue.message;
    }
    throw new AppError('VALIDATION_ERROR', { details: { fields } });
  }
  Object.defineProperty(req, source, { value: result.data, writable: true, configurable: true });
  next();
};
