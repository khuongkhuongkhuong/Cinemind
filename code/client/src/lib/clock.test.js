import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { formatCountdown, msUntil, noteServerDate, resetClock, serverNow } from './clock';
import { useCountdown } from '@/hooks/useCountdown';

beforeEach(() => { resetClock(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T12:00:00.000Z')); });
afterEach(() => { vi.useRealTimers(); resetClock(); });

describe('formatCountdown', () => {
  it('mm:ss, làm tròn LÊN theo giây để không hiện 00:00 khi còn vài trăm ms', () => {
    expect(formatCountdown(523_000)).toBe('08:43');
    expect(formatCountdown(600_000)).toBe('10:00');
    expect(formatCountdown(59_001)).toBe('01:00');
    expect(formatCountdown(500)).toBe('00:01');
    expect(formatCountdown(0)).toBe('00:00');
  });
});

describe('đồng hồ server', () => {
  it('không có thông tin thì dùng đồng hồ máy', () => expect(serverNow()).toBe(Date.now()));

  it('⭐ suy ra độ lệch từ header Date: máy chạy NHANH 5 phút so với server', () => {
    noteServerDate(new Date('2026-10-02T11:55:00.000Z').toUTCString()); // server: 11:55, máy: 12:00
    expect(serverNow()).toBe(Date.parse('2026-10-02T11:55:00.000Z'));
    expect(msUntil('2026-10-02T12:05:00.000Z')).toBe(10 * 60_000); // hạn 12:05 theo server => còn 10 phút (máy tưởng chỉ còn 5)
  });

  it('header thiếu hoặc sai định dạng thì bỏ qua (giữ độ lệch cũ)', () => {
    noteServerDate('khong-phai-ngay');
    noteServerDate(undefined);
    expect(serverNow()).toBe(Date.now());
  });

  it('msUntil không bao giờ âm', () => expect(msUntil('2020-01-01T00:00:00.000Z')).toBe(0));
});

describe('useCountdown', () => {
  it('đếm ngược mỗi giây và gọi onExpire đúng MỘT lần khi về 0', () => {
    let fired = 0;
    const expiresAt = new Date(Date.now() + 3_000).toISOString();
    const { result } = renderHook(() => useCountdown(expiresAt, () => { fired++; }));
    expect(result.current).toBe(3_000);
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(result.current).toBe(2_000);
    expect(fired).toBe(0);
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(result.current).toBe(0);
    expect(fired).toBe(1);
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(fired).toBe(1); // không gọi lặp
  });

  it('không có expiresAt thì không đếm, không gọi gì', () => {
    let fired = 0;
    const { result } = renderHook(() => useCountdown(null, () => { fired++; }));
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(result.current).toBe(0);
    expect(fired).toBe(0);
  });

  it('hạn đã qua từ đầu: báo hết giờ ngay', () => {
    let fired = 0;
    renderHook(() => useCountdown(new Date(Date.now() - 1000).toISOString(), () => { fired++; }));
    expect(fired).toBe(1);
  });
});
