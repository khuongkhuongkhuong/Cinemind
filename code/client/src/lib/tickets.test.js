import { describe, expect, it } from 'vitest';
import { checkInReasonText, formatTicketCode, normalizeTicketCode, orderStatusInfo, ticketUsage } from './tickets';

describe('normalizeTicketCode — mã gõ tay hoặc nội dung QR đều về một dạng', () => {
  it.each([
    ['K7Q2M9XA', 'K7Q2M9XA'],
    ['k7q2m9xa', 'K7Q2M9XA'],
    ['K7Q2-M9XA', 'K7Q2M9XA'],
    ['  k7q2 m9xa  ', 'K7Q2M9XA'],
    ['CINEMIND:K7Q2M9XA', 'K7Q2M9XA'],
    ['cinemind:k7q2-m9xa', 'K7Q2M9XA'],
    ['  CineMind: K7Q2M9XA ', 'K7Q2M9XA'],
  ])('%j -> %s', (input, expected) => expect(normalizeTicketCode(input)).toBe(expected));

  it('giá trị rỗng / không phải chuỗi', () => {
    expect(normalizeTicketCode('')).toBe('');
    expect(normalizeTicketCode(null)).toBe('');
    expect(normalizeTicketCode(undefined)).toBe('');
  });
});

describe('formatTicketCode', () => {
  it('chia 4-4 cho dễ đọc', () => expect(formatTicketCode('K7Q2M9XA')).toBe('K7Q2-M9XA'));
  it('mã không đúng 8 ký tự thì giữ nguyên; thiếu thì chuỗi rỗng', () => {
    expect(formatTicketCode('ABC')).toBe('ABC');
    expect(formatTicketCode(undefined)).toBe('');
  });
});

describe('ticketUsage', () => {
  const order = (extra = {}) => ({ status: 'PAID', checkedInAt: null, showtime: { startTime: '2026-10-02T12:00:00.000Z' }, ...extra });
  const at = (iso) => Date.parse(iso);
  it('đơn chưa thanh toán không có trạng thái sử dụng', () => {
    for (const status of ['PENDING', 'CANCELLED', 'EXPIRED', 'REFUND_PENDING', 'REFUNDED']) expect(ticketUsage(order({ status }))).toBeNull();
  });
  it('đã check-in -> USED (ưu tiên hơn mọi thứ khác)', () => expect(ticketUsage(order({ checkedInAt: '2026-10-02T11:50:00Z' }), at('2027-01-01T00:00:00Z'))).toBe('USED'));
  it('chưa tới giờ hoặc đang chiếu -> UPCOMING; qua 1 giờ sau giờ bắt đầu -> PAST', () => {
    expect(ticketUsage(order(), at('2026-10-01T00:00:00Z'))).toBe('UPCOMING');
    expect(ticketUsage(order(), at('2026-10-02T12:30:00Z'))).toBe('UPCOMING');
    expect(ticketUsage(order(), at('2026-10-02T13:30:00Z'))).toBe('PAST');
  });
});

describe('nhãn', () => {
  it('trạng thái đơn', () => {
    expect(orderStatusInfo('PAID')).toEqual({ label: 'Đã thanh toán', tone: 'ok' });
    expect(orderStatusInfo('REFUND_PENDING').tone).toBe('warn');
    expect(orderStatusInfo('XYZ').label).toBe('XYZ');
  });
  it('mọi lý do check-in đều có câu riêng; lý do lạ có câu mặc định', () => {
    for (const r of ['NOT_PAID', 'ALREADY_USED', 'TOO_EARLY', 'TOO_LATE', 'SHOWTIME_CANCELLED']) expect(checkInReasonText(r)).toMatch(/\S/);
    expect(checkInReasonText('TOO_EARLY')).toMatch(/30 phút/);
    expect(checkInReasonText('???')).toBe('Vé không hợp lệ để vào rạp.');
  });
});
