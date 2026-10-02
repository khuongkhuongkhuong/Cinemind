import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

const NAV = [
  { to: '/admin', label: 'Tổng quan', icon: '📊', end: true },
  { to: '/admin/movies', label: 'Phim', icon: '🎬' },
  { to: '/admin/showtimes', label: 'Suất chiếu', icon: '🕒' },
  { to: '/admin/cinemas', label: 'Rạp & phòng', icon: '🏛️' },
  { to: '/admin/pricing', label: 'Bảng giá', icon: '💰' },
  { to: '/admin/orders', label: 'Đơn hàng', icon: '🧾' },
  { to: '/admin/combos', label: 'Combo', icon: '🍿' },
  { to: '/admin/promotions', label: 'Khuyến mãi', icon: '🎟️' },
  { to: '/admin/banners', label: 'Banner', icon: '🖼️' },
  { to: '/admin/users', label: 'Người dùng', icon: '👥' },
  { to: '/admin/audit', label: 'Nhật ký', icon: '📜' },
];

const link = ({ isActive }) =>
  `flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${isActive ? 'bg-brand-600 text-white' : 'text-ink-300 hover:bg-ink-800 hover:text-brand-600'}`;

/**
 * Khung trang quản trị (05-ui-pages A01–A10): thanh bên trái + nội dung. Trên điện thoại thanh bên thành dải cuộn ngang.
 * Đây chỉ là giao diện: quyền thật do server kiểm tra ở MỖI request (/admin/* đọc lại vai trò từ DB).
 */
export default function AdminLayout() {
  const { user, logout } = useAuth();
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <aside className="border-b border-ink-700 bg-ink-900 lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-3 px-4 py-3 lg:block lg:py-5">
          <Link to="/admin" className="text-xl font-extrabold tracking-wide text-ink-100">CINE<span className="text-brand-500">MIND</span> <span className="text-xs font-semibold text-ink-300">Quản trị</span></Link>
          <Link to="/" className="text-xs text-ink-300 hover:text-brand-600 lg:mt-1 lg:block">← Về trang khách</Link>
        </div>
        <nav aria-label="Quản trị" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:px-3 lg:pb-0">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={link}><span aria-hidden="true">{n.icon}</span>{n.label}</NavLink>
          ))}
        </nav>
        <div className="hidden border-t border-ink-700 p-4 text-sm lg:absolute lg:inset-x-0 lg:bottom-0 lg:block">
          <p className="truncate font-semibold">{user?.fullName}</p>
          <p className="truncate text-xs text-ink-300">{user?.email}</p>
          <button type="button" onClick={logout} className="mt-2 text-xs text-red-300 hover:text-red-200">Đăng xuất</button>
        </div>
      </aside>
      <main id="main" className="min-w-0 flex-1 px-4 py-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}
