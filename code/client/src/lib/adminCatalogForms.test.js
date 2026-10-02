import { describe, expect, it } from 'vitest';
import {
  EMPTY_BANNER, EMPTY_COMBO, EMPTY_PROMO, EMPTY_STAFF, bannerToBody, barHeights, comboToBody, isSafeUrl, promoToBody, staffToBody, sumRevenue,
  validateBanner, validateCombo, validatePromo, validateStaff,
} from './adminCatalogForms';

describe('combo form', () => {
  it('hợp lệ / lỗi', () => {
    expect(validateCombo({ ...EMPTY_COMBO, name: 'Combo 1', price: '89000' })).toEqual({});
    expect(Object.keys(validateCombo({ ...EMPTY_COMBO, price: '-5', imageUrl: 'ftp://x' })).sort()).toEqual(['imageUrl', 'name', 'price']);
  });
  it('body: ô trống -> null, giá là số', () => {
    expect(comboToBody({ ...EMPTY_COMBO, name: ' A ', price: '50000' })).toEqual({ name: 'A', description: null, price: 50000, imageUrl: null, isActive: true });
  });
});

describe('promotion form', () => {
  const good = { ...EMPTY_PROMO, code: 'sale10', name: 'Giảm 10%', discountValue: '10', maxDiscount: '30000', start: '2030-01-01T00:00', end: '2030-02-01T00:00' };
  it('hợp lệ', () => expect(validatePromo(good, true)).toEqual({}));
  it('phần trăm > 100 bị từ chối; FIXED thì không giới hạn 100', () => {
    expect(validatePromo({ ...good, discountValue: '150' }, true).discountValue).toBeTruthy();
    expect(validatePromo({ ...good, discountType: 'FIXED', discountValue: '150000' }, true).discountValue).toBeUndefined();
  });
  it('kết thúc không sau bắt đầu bị từ chối', () => expect(validatePromo({ ...good, end: '2030-01-01T00:00' }, true).end).toBeTruthy());
  it('mã chỉ kiểm khi tạo (khi sửa mã không đổi)', () => {
    expect(validatePromo({ ...good, code: 'a b' }, true).code).toBeTruthy();
    expect(validatePromo({ ...good, code: 'a b' }, false).code).toBeUndefined();
  });
  it('body tạo: mã VIẾT HOA, giờ VN -> UTC; body sửa: KHÔNG có code', () => {
    expect(promoToBody(good, true)).toMatchObject({ code: 'SALE10', startAt: '2029-12-31T17:00:00.000Z', usageLimit: null });
    expect(promoToBody(good, false)).not.toHaveProperty('code');
  });
  it('FIXED thì bỏ maxDiscount (chỉ có nghĩa với PERCENT)', () => {
    expect(promoToBody({ ...good, discountType: 'FIXED', discountValue: '20000' }, true).maxDiscount).toBeNull();
  });
});

describe('banner form', () => {
  const good = { ...EMPTY_BANNER, title: 'Tết', imageUrl: '/banners/tet.jpg' };
  it('hợp lệ (đường dẫn nội bộ & http đều được)', () => {
    expect(validateBanner(good)).toEqual({});
    expect(validateBanner({ ...good, imageUrl: 'https://cdn.x/a.jpg', linkUrl: '/movies' })).toEqual({});
  });
  it.each(['//evil.com/x', 'javascript:alert(1)', 'data:text/html,x', 'ftp://x'])('⭐ từ chối URL nguy hiểm %s', (u) => {
    expect(isSafeUrl(u)).toBe(false);
    expect(validateBanner({ ...good, linkUrl: u }).linkUrl).toBeTruthy();
    expect(validateBanner({ ...good, imageUrl: u }).imageUrl).toBeTruthy();
  });
  it('body: thời gian trống -> null', () => expect(bannerToBody(good)).toMatchObject({ linkUrl: null, startAt: null, endAt: null, sortOrder: 0 }));
});

describe('staff form', () => {
  const good = { ...EMPTY_STAFF, fullName: 'Nhân viên A', email: 'a@x.vn', password: '12345678' };
  it('hợp lệ', () => expect(validateStaff(good)).toEqual({}));
  it('mật khẩu ngắn / email sai / sđt sai', () => {
    expect(Object.keys(validateStaff({ ...good, password: '123', email: 'x', phone: '12' })).sort()).toEqual(['email', 'password', 'phone']);
  });
  it('⭐ body KHÔNG chứa role; sđt trống thì không gửi', () => {
    const b = staffToBody(good);
    expect(b).not.toHaveProperty('role');
    expect(b).not.toHaveProperty('phone');
  });
});

describe('biểu đồ doanh thu', () => {
  const rows = [{ revenue: 0, ticketCount: 0, orderCount: 0 }, { revenue: 1, ticketCount: 1, orderCount: 1 }, { revenue: 1000, ticketCount: 5, orderCount: 2 }];
  it('cột cao nhất 100%, ngày 0đ là 0, doanh thu rất nhỏ vẫn thấy được (>= 2%)', () => expect(barHeights(rows)).toEqual([0, 2, 100]));
  it('toàn 0đ -> không chia cho 0', () => expect(barHeights([{ revenue: 0 }, { revenue: 0 }])).toEqual([0, 0]));
  it('tổng', () => expect(sumRevenue(rows)).toEqual({ revenue: 1001, ticketCount: 6, orderCount: 3 }));
});
