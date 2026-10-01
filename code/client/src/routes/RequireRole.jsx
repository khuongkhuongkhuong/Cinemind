import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

/**
 * Bọc các route theo vai trò, đặt BÊN TRONG RequireAuth. Ví dụ: <RequireRole roles={['ADMIN']} />.
 * Đây chỉ là tiện cho người dùng (ẩn trang không dành cho họ); quyền thật luôn do server kiểm tra (403 FORBIDDEN).
 */
export default function RequireRole({ roles }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) return <Navigate to="/403" replace />;
  return <Outlet />;
}
