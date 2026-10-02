import { useEffect, useRef, useState } from 'react';
import { msUntil } from '@/lib/clock';

/**
 * Đếm ngược tới `expiresAt` (ISO, hạn do SERVER đặt) theo đồng hồ server. Cập nhật mỗi giây; gọi `onExpire` đúng MỘT lần khi hết giờ.
 * @returns {number} số mili-giây còn lại (0 khi đã hết)
 */
export function useCountdown(expiresAt, onExpire) {
  const [remaining, setRemaining] = useState(() => (expiresAt ? msUntil(expiresAt) : 0));
  const fired = useRef(false);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    if (!expiresAt) return undefined;
    fired.current = false;
    const tick = () => {
      const ms = msUntil(expiresAt);
      setRemaining(ms);
      if (ms <= 0 && !fired.current) {
        fired.current = true;
        onExpireRef.current?.();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return remaining;
}
