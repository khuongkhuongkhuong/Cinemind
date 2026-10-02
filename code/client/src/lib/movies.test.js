import { describe, expect, it } from 'vitest';
import { apiStatusToUrl, audioLabel, countOpenShowtimes, countShowtimes, formatLabel, safeExternalUrl, showGroupLabel, urlStatusToApi } from './movies';
import { formatDateOnly } from './format';

const schedule = {
  date: '2026-10-02',
  cinemas: [
    { cinema: { id: 'c1' }, groups: [
      { format: 'F2D', audio: 'SUBTITLE', showtimes: [{ id: 'a', isOpenForSale: true }, { id: 'b', isOpenForSale: false }] },
      { format: 'IMAX', audio: 'DUBBED', showtimes: [{ id: 'c', isOpenForSale: true }] },
    ] },
    { cinema: { id: 'c2' }, groups: [{ format: 'F3D', audio: 'SUBTITLE', showtimes: [{ id: 'd', isOpenForSale: false }] }] },
  ],
};

describe('nhãn', () => {
  it('định dạng và âm thanh', () => {
    expect(formatLabel('F2D')).toBe('2D');
    expect(formatLabel('IMAX')).toBe('IMAX');
    expect(audioLabel('SUBTITLE')).toBe('Phụ đề');
    expect(audioLabel('DUBBED')).toBe('Lồng tiếng');
    expect(showGroupLabel({ format: 'F3D', audio: 'DUBBED' })).toBe('3D Lồng tiếng');
  });
  it('giá trị lạ được giữ nguyên thay vì thành undefined', () => expect(formatLabel('F9D')).toBe('F9D'));
});

describe('trạng thái trên URL', () => {
  it('đổi qua lại giữa now/soon và enum của API', () => {
    expect(urlStatusToApi('now')).toBe('NOW_SHOWING');
    expect(urlStatusToApi('soon')).toBe('COMING_SOON');
    expect(apiStatusToUrl('COMING_SOON')).toBe('soon');
    expect(apiStatusToUrl('NOW_SHOWING')).toBe('now');
  });
  it('thiếu hoặc sai thì mặc định đang chiếu (không cho URL ép gửi giá trị lạ lên API)', () => {
    expect(urlStatusToApi(null)).toBe('NOW_SHOWING');
    expect(urlStatusToApi('ENDED')).toBe('NOW_SHOWING');
    expect(urlStatusToApi('xyz')).toBe('NOW_SHOWING');
  });
});

describe('đếm suất chiếu', () => {
  it('đếm tổng và số suất còn mở bán', () => {
    expect(countShowtimes(schedule)).toBe(4);
    expect(countOpenShowtimes(schedule)).toBe(2);
  });
  it('lịch trống / chưa có dữ liệu', () => {
    expect(countShowtimes({ date: 'x', cinemas: [] })).toBe(0);
    expect(countOpenShowtimes(undefined)).toBe(0);
    expect(countShowtimes(undefined)).toBe(0);
  });
});

describe('safeExternalUrl — chặn javascript: trong link do admin nhập', () => {
  it('chỉ nhận http(s)', () => {
    expect(safeExternalUrl('https://youtube.com/watch?v=1')).toBe('https://youtube.com/watch?v=1');
    expect(safeExternalUrl('http://example.com')).toBe('http://example.com');
  });
  it.each(['javascript:alert(1)', 'data:text/html,x', 'ftp://x.com', '//x.com', '/noi-bo', '', null, undefined, 42])('từ chối %s', (bad) => {
    expect(safeExternalUrl(bad)).toBeNull();
  });
});

describe('formatDateOnly', () => {
  it('đổi YYYY-MM-DD sang dd/MM/yyyy mà không lệch múi giờ', () => {
    expect(formatDateOnly('2026-09-12')).toBe('12/09/2026');
    expect(formatDateOnly('2026-01-01')).toBe('01/01/2026');
  });
});
