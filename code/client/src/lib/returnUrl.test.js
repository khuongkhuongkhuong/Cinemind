import { describe, expect, it } from 'vitest';
import { loginUrl, safeReturnUrl } from './returnUrl';

describe('safeReturnUrl — chống open redirect sau khi đăng nhập', () => {
  it('chấp nhận đường dẫn nội bộ (có query)', () => {
    expect(safeReturnUrl('/me/tickets')).toBe('/me/tickets');
    expect(safeReturnUrl('/booking/showtimes/abc?x=1#top')).toBe('/booking/showtimes/abc?x=1#top');
  });

  it.each([
    ['URL tuyệt đối', 'https://trang-gia-mao.com'],
    ['URL theo giao thức hiện tại', '//trang-gia-mao.com/x'],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,<script>1</script>'],
    ['dùng dấu gạch ngược (trình duyệt coi như /)', '/\trang-gia-mao.com'],
    ['không bắt đầu bằng /', 'me/tickets'],
    ['ký tự điều khiển', '/a\nb'],
    ['rỗng', ''],
  ])('từ chối %s', (_, bad) => expect(safeReturnUrl(bad)).toBe('/'));

  it('từ chối giá trị không phải chuỗi', () => {
    expect(safeReturnUrl(null)).toBe('/');
    expect(safeReturnUrl(undefined)).toBe('/');
    expect(safeReturnUrl(['/a'])).toBe('/');
  });

  it('không quay lại chính trang đăng nhập / đăng ký (tránh vòng lặp)', () => {
    expect(safeReturnUrl('/login')).toBe('/');
    expect(safeReturnUrl('/login?returnUrl=%2Fx')).toBe('/');
    expect(safeReturnUrl('/register')).toBe('/');
    expect(safeReturnUrl('/loginx')).toBe('/loginx'); // chỉ chặn đúng /login, không chặn tiền tố khác
  });

  it('có thể đổi nơi quay về mặc định', () => expect(safeReturnUrl('//x', '/me/tickets')).toBe('/me/tickets'));

  it('loginUrl: đang ở /login hoặc /register thì không lồng returnUrl vào chính trang đăng nhập', () => {
    expect(loginUrl('/login?returnUrl=%2Fadmin')).toBe('/login');
    expect(loginUrl('/register')).toBe('/login');
  });
  it('loginUrl mã hóa nơi quay lại', () => {
    expect(loginUrl('/booking/orders/1?a=b')).toBe('/login?returnUrl=%2Fbooking%2Forders%2F1%3Fa%3Db');
  });
});
