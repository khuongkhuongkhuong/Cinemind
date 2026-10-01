import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { loginUrl } from '@/lib/returnUrl';
import { PageSpinner } from '@/components/ui/Spinner';

/** Bọc các route cần đăng nhập. Chưa đăng nhập → /login?returnUrl=<trang hiện tại>; đăng nhập xong quay lại đúng chỗ. */
export default function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <PageSpinner label="Đang kiểm tra đăng nhập" />; // chưa biết → đừng vội đẩy ra trang đăng nhập
  if (status === 'anonymous') return <Navigate to={loginUrl(location.pathname + location.search)} replace />;
  return <Outlet />;
}
