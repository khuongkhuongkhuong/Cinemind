import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { isAdmin, isStaff, useAuth } from '@/hooks/useAuth';
import { loginUrl } from '@/lib/returnUrl';
import Button from '@/components/ui/Button';

const NAV = [{ to: '/movies', label: 'Phim' }, { to: '/cinemas', label: 'Rạp' }];
const navClass = ({ isActive }) =>
  `rounded-md px-3 py-2 text-sm font-medium transition-colors ${isActive ? 'text-white' : 'text-ink-300 hover:text-white'}`;

/** Menu tài khoản theo vai trò: Vé của tôi, Hồ sơ, [Soát vé], [Quản trị], Đăng xuất (05-ui-pages mục 2). */
function UserMenu({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const item = 'block w-full px-4 py-2 text-left text-sm text-ink-100 hover:bg-ink-700';
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-10 items-center gap-2 rounded-lg border border-ink-600 bg-ink-800 px-3 text-sm hover:border-ink-300"
      >
        <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-xs font-bold">
          {user.fullName.trim().charAt(0).toUpperCase()}
        </span>
        <span className="hidden max-w-32 truncate sm:inline">{user.fullName}</span>
        <span aria-hidden="true" className="text-ink-300">▾</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-xl border border-ink-600 bg-ink-800 py-1 shadow-xl">
          <div className="border-b border-ink-700 px-4 py-2 text-xs text-ink-300">
            <div className="truncate">{user.email}</div>
            <div>{user.points} điểm</div>
          </div>
          <Link role="menuitem" to="/me/tickets" className={item}>Vé của tôi</Link>
          <Link role="menuitem" to="/me/profile" className={item}>Hồ sơ cá nhân</Link>
          {isStaff(user) && <Link role="menuitem" to="/staff/check-in" className={item}>Soát vé</Link>}
          {isAdmin(user) && <Link role="menuitem" to="/admin" className={item}>Quản trị</Link>}
          <button role="menuitem" type="button" onClick={onLogout} className={`${item} border-t border-ink-700 text-red-300`}>Đăng xuất</button>
        </div>
      )}
    </div>
  );
}

export default function Header() {
  const { status, user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => setMobileOpen(false), [location.pathname]);

  const search = (e) => {
    e.preventDefault();
    const q = query.trim();
    navigate(q ? `/movies?q=${encodeURIComponent(q)}` : '/movies');
  };

  return (
    <header className="sticky top-0 z-30 border-b border-ink-700 bg-ink-900/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
        <Link to="/" className="text-xl font-extrabold tracking-wide text-white" aria-label="Cinemind — trang chủ">
          CINE<span className="text-brand-500">MIND</span>
        </Link>

        <nav aria-label="Điều hướng chính" className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => <NavLink key={n.to} to={n.to} className={navClass}>{n.label}</NavLink>)}
        </nav>

        <form onSubmit={search} role="search" className="ml-auto hidden max-w-xs flex-1 md:block">
          <label htmlFor="header-search" className="sr-only">Tìm phim</label>
          <input
            id="header-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm phim..."
            className="h-10 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 text-sm placeholder:text-ink-300/60 hover:border-ink-300"
          />
        </form>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          {status === 'loading' ? (
            <div className="h-10 w-28 animate-pulse rounded-lg bg-ink-700" aria-hidden="true" />
          ) : user ? (
            <UserMenu user={user} onLogout={logout} />
          ) : (
            <>
              <Link to={loginUrl(location.pathname + location.search)}><Button size="md">Đăng nhập</Button></Link>
              <Link to="/register" className="hidden sm:block"><Button variant="secondary">Đăng ký</Button></Link>
            </>
          )}
          <button
            type="button" onClick={() => setMobileOpen((v) => !v)} aria-label="Mở menu" aria-expanded={mobileOpen}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-ink-600 md:hidden"
          >
            <span aria-hidden="true">{mobileOpen ? '✕' : '☰'}</span>
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="border-t border-ink-700 bg-ink-900 px-4 pb-4 md:hidden">
          <form onSubmit={search} role="search" className="py-3">
            <label htmlFor="header-search-m" className="sr-only">Tìm phim</label>
            <input
              id="header-search-m" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm phim..."
              className="h-10 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 text-sm"
            />
          </form>
          <nav aria-label="Điều hướng chính (di động)" className="flex flex-col">
            {NAV.map((n) => <NavLink key={n.to} to={n.to} className={navClass}>{n.label}</NavLink>)}
            {!user && status !== 'loading' && <Link to="/register" className="px-3 py-2 text-sm text-ink-300 hover:text-white">Đăng ký</Link>}
          </nav>
        </div>
      )}
    </header>
  );
}
