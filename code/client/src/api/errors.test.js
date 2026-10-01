import { describe, expect, it } from 'vitest';
import { errorMessage, fieldErrors, hasCode, normalizeError } from './errors';

const serverError = (status, code, message, details) => ({ response: { status, data: { success: false, error: { code, message, details } } } });

describe('normalizeError', () => {
  it('đọc lỗi chuẩn của server', () => {
    const e = normalizeError(serverError(409, 'SEAT_UNAVAILABLE', 'Ghế G6 vừa có người chọn', { seatLabels: ['G6'] }));
    expect(e).toEqual({ status: 409, code: 'SEAT_UNAVAILABLE', message: 'Ghế G6 vừa có người chọn', details: { seatLabels: ['G6'] } });
  });
  it('lỗi HTTP không theo định dạng chuẩn (vd proxy trả 502)', () => {
    expect(normalizeError({ response: { status: 502, data: '<html>' } })).toMatchObject({ status: 502, code: 'HTTP_ERROR' });
  });
  it('mất mạng (không có response) -> NETWORK_ERROR', () => {
    expect(normalizeError(new Error('Network Error'))).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });
  it('yêu cầu bị hủy', () => expect(normalizeError({ code: 'ERR_CANCELED' }).code).toBe('CANCELED'));
});

describe('hasCode / fieldErrors / errorMessage', () => {
  it('rẽ nhánh theo code', () => {
    const err = serverError(400, 'VALIDATION_ERROR', 'x', { fields: { email: 'Email không hợp lệ' } });
    expect(hasCode(err, 'VALIDATION_ERROR')).toBe(true);
    expect(hasCode(err, 'NOT_FOUND')).toBe(false);
    expect(fieldErrors(err)).toEqual({ email: 'Email không hợp lệ' });
  });
  it('fieldErrors rỗng khi không có chi tiết', () => expect(fieldErrors(new Error('x'))).toEqual({}));
  it('RATE_LIMITED có lời nhắn riêng thân thiện', () => {
    expect(errorMessage(serverError(429, 'RATE_LIMITED', 'raw'))).toMatch(/quá nhiều lần/);
  });
});
