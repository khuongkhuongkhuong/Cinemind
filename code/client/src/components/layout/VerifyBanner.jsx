import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

/** Dải nhắc ở đầu trang khách khi tài khoản chưa xác minh email (BR-40). */
export default function VerifyBanner() {
  const { user } = useAuth();
  const { pathname, search } = useLocation();
  if (user?.emailVerified !== false || pathname === '/verify-email') return null;
  return (
    <div role="status" className="border-b border-warn/40 bg-warn/10 px-4 py-2 text-center text-sm text-gold-400">
      Email của bạn chưa được xác minh nên chưa đặt vé được.{' '}
      <Link to={`/verify-email?returnUrl=${encodeURIComponent(pathname + search)}`} className="font-bold underline">Xác minh ngay</Link>
    </div>
  );
}
