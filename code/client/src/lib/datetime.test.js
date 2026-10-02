import { describe, expect, it } from 'vitest';
import { isoToVnInput, vnInputToIso } from './datetime';

describe('vnInputToIso — admin nhập GIỜ VIỆT NAM, gửi UTC', () => {
  it('18:30 giờ VN = 11:30 UTC', () => expect(vnInputToIso('2026-10-05T18:30')).toBe('2026-10-05T11:30:00.000Z'));
  it('qua nửa đêm: 01:00 giờ VN ngày 06 = 18:00 UTC ngày 05', () => expect(vnInputToIso('2026-10-06T01:00')).toBe('2026-10-05T18:00:00.000Z'));
  it('đầu năm / cuối tháng', () => {
    expect(vnInputToIso('2026-01-01T00:30')).toBe('2025-12-31T17:30:00.000Z');
    expect(vnInputToIso('2026-10-31T23:59')).toBe('2026-10-31T16:59:00.000Z');
  });
  it.each(['', null, undefined, '2026-10-05', '2026-10-05 18:30', '05/10/2026 18:30', '2026-13-45T25:61'])('từ chối %j', (bad) => {
    expect(vnInputToIso(bad)).toBeNull();
  });
});

describe('isoToVnInput', () => {
  it('11:30 UTC = 18:30 giờ VN', () => expect(isoToVnInput('2026-10-05T11:30:00.000Z')).toBe('2026-10-05T18:30'));
  it('qua nửa đêm', () => expect(isoToVnInput('2026-10-05T18:00:00.000Z')).toBe('2026-10-06T01:00'));
  it('giá trị sai thì trả chuỗi rỗng', () => expect(isoToVnInput('khong-phai-ngay')).toBe(''));
  it('đổi đi rồi đổi lại ra đúng giá trị ban đầu', () => {
    for (const v of ['2026-10-05T18:30', '2026-12-31T23:45', '2026-01-01T00:00']) expect(isoToVnInput(vnInputToIso(v))).toBe(v);
  });
});
