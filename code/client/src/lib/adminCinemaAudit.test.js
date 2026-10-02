import { describe, expect, it } from 'vitest';
import { EMPTY_CINEMA, actionLabel, cinemaToBody, cinemaToForm, describeDetails, validateCinema } from './adminCatalogForms';

describe('cinema form', () => {
  const good = { ...EMPTY_CINEMA, cityId: 'c1', name: ' Rạp A ', address: '1 Đường X' };
  it('hợp lệ', () => expect(validateCinema(good)).toEqual({}));
  it('thiếu thành phố / tên / địa chỉ, sđt sai', () => {
    expect(Object.keys(validateCinema({ ...EMPTY_CINEMA, phone: '123' })).sort()).toEqual(['address', 'cityId', 'name', 'phone']);
  });
  it('body: trim, sđt trống -> null (server nhận null chứ không nhận chuỗi rỗng)', () => {
    expect(cinemaToBody(good)).toEqual({ cityId: 'c1', name: 'Rạp A', address: '1 Đường X', phone: null, isActive: true });
  });
  it('cinemaToForm lấy id thành phố từ đối tượng city', () => {
    expect(cinemaToForm({ city: { id: 'c9' }, name: 'A', address: 'B', phone: null, isActive: false })).toEqual({ cityId: 'c9', name: 'A', address: 'B', phone: '', isActive: false });
  });
});

describe('nhật ký', () => {
  it('nhãn tiếng Việt cho thao tác quen thuộc; mẫu lạ hiện nguyên văn (không bao giờ mất thông tin)', () => {
    expect(actionLabel('PATCH /admin/orders/:id/refund')).toBe('Ghi nhận hoàn tiền');
    expect(actionLabel('POST /staff/tickets/:code/check-in')).toBe('Soát vé');
    expect(actionLabel('POST /admin/something-new')).toBe('POST /admin/something-new');
  });
  it('describeDetails: ưu tiên giá trị an toàn, không thì liệt kê tên trường, không có thì rỗng', () => {
    expect(describeDetails({ fields: ['role'], values: { role: 'ADMIN' } })).toBe('role = ADMIN');
    expect(describeDetails({ fields: ['name', 'address'] })).toBe('trường: name, address');
    expect(describeDetails({ fields: [] })).toBe('');
    expect(describeDetails(null)).toBe('');
  });
});
