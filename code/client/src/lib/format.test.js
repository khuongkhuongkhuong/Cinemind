import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatMoney, formatTime, formatWeekday, nextDays, vnDateKey } from './format';

describe('formatMoney', () => {
  it('nhóm hàng nghìn bằng dấu chấm và thêm đ', () => {
    expect(formatMoney(154000)).toBe('154.000đ');
    expect(formatMoney(0)).toBe('0đ');
    expect(formatMoney(1250000)).toBe('1.250.000đ');
  });
  it('không hỏng khi thiếu giá trị', () => expect(formatMoney(undefined)).toBe('0đ'));
});

describe('thời gian luôn theo giờ Việt Nam (UTC+7), bất kể máy người dùng ở múi giờ nào', () => {
  it('12:45 UTC là 19:45 giờ VN, thứ sáu 02/10/2026', () => {
    const iso = '2026-10-02T12:45:00.000Z';
    expect(formatTime(iso)).toBe('19:45');
    expect(formatDate(iso)).toBe('02/10/2026');
    expect(formatWeekday(iso)).toBe('T6');
    expect(formatDateTime(iso)).toBe('19:45 T6 02/10/2026');
  });
  it('qua nửa đêm giờ VN thì sang ngày hôm sau: 18:00 UTC thứ năm = 01:00 thứ sáu', () => {
    const iso = '2026-10-01T18:00:00.000Z';
    expect(formatDateTime(iso)).toBe('01:00 T6 02/10/2026');
    expect(vnDateKey(iso)).toBe('2026-10-02');
  });
  it('chủ nhật hiển thị là CN', () => expect(formatWeekday('2026-10-04T05:00:00Z')).toBe('CN'));
});

describe('nextDays (bộ chọn ngày của lịch chiếu)', () => {
  it('trả đủ số ngày, bắt đầu từ hôm nay GIỜ VN, liên tiếp', () => {
    const days = nextDays(7, new Date('2026-10-01T18:30:00Z')); // 01:30 sáng 02/10 giờ VN
    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({ key: '2026-10-02', weekday: 'T6', label: '02/10' });
    expect(days[1].key).toBe('2026-10-03');
    expect(days[6]).toEqual({ key: '2026-10-08', weekday: 'T5', label: '08/10' });
  });
  it('đi qua cuối tháng', () => {
    const days = nextDays(3, new Date('2026-10-30T05:00:00Z'));
    expect(days.map((d) => d.key)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
  });
});
