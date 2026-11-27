import { describe, expect, it } from 'vitest';
import { change, compactMoney, labelIndexes, niceTicks, previousRange, shortDate } from './revenueChart';

describe('revenueChart (hàm thuần)', () => {
  it('kỳ trước dài bằng kỳ đang xem và liền ngay trước, qua ranh giới tháng', () => {
    expect(previousRange('2026-11-14', '2026-11-27')).toEqual({ from: '2026-10-31', to: '2026-11-13' });
    expect(previousRange('2026-11-27', '2026-11-27')).toEqual({ from: '2026-11-26', to: '2026-11-26' });
  });
  it('tăng / giảm theo phần trăm; kỳ trước bằng 0 thì không tính', () => {
    expect(change(150, 100)).toEqual({ percent: 50, direction: 'up' });
    expect(change(50, 100)).toEqual({ percent: 50, direction: 'down' });
    expect(change(100, 100)).toEqual({ percent: 0, direction: 'flat' });
    expect(change(100, 0)).toBeNull();
  });
  it('mốc trục tròn số, bắt đầu từ 0 và phủ hết giá trị lớn nhất', () => {
    expect(niceTicks(4_200_000)).toEqual([0, 2_000_000, 4_000_000, 6_000_000]);
    expect(niceTicks(900_000)).toEqual([0, 250_000, 500_000, 750_000, 1_000_000]);
    expect(niceTicks(0)).toEqual([0, 1]);
  });
  it('nhãn gọn và nhãn ngày cách đều, luôn có ngày cuối', () => {
    expect([compactMoney(2_500_000), compactMoney(500_000), compactMoney(0)]).toEqual(['2,5 tr', '500k', '0']);
    expect(labelIndexes(30).size).toBeLessThanOrEqual(8);
    expect(labelIndexes(30).has(29)).toBe(true);
    expect([...labelIndexes(3)].sort()).toEqual([0, 1, 2]);
    expect(shortDate('2026-11-07')).toBe('07/11');
  });
});
