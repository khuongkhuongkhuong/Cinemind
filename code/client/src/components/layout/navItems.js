// Các mục của thanh menu (05-ui-pages mục 2). Mỗi mục có `useItems` trả về menu con; hook chỉ chạy khi menu con thực sự hiện ra,
// nên danh sách thành phố chỉ được tải khi người dùng mở menu "Rạp".
import { useCities } from '@/hooks/useMovies';

const MOVIE_ITEMS = [
  { to: '/movies?status=now', label: 'Phim đang chiếu' },
  { to: '/movies?status=soon', label: 'Phim sắp chiếu' },
];

// "Tài khoản" là trang cần đăng nhập: khách bấm vào sẽ được đưa tới đăng nhập rồi quay lại (RequireAuth).
const MEMBER_ITEMS = [
  { to: '/me/profile', label: 'Tài khoản Cinemind' },
  { to: '/members', label: 'Quyền lợi' },
];

const ALL_CINEMAS = { to: '/cinemas', label: 'Tất cả các rạp' };

/** "Tất cả các rạp" + một mục cho mỗi thành phố (lấy từ API; chưa tải xong hoặc lỗi thì vẫn còn mục đầu). */
function useCinemaItems() {
  const { data = [] } = useCities();
  return [ALL_CINEMAS, ...data.map((c) => ({ to: `/cinemas?city=${c.id}`, label: `Rạp tại ${c.name}` }))];
}

export const NAV = [
  { to: '/movies', label: 'Phim', useItems: () => MOVIE_ITEMS },
  { to: '/cinemas', label: 'Rạp Cinemind', useItems: useCinemaItems },
  { to: '/members', label: 'Thành viên', useItems: () => MEMBER_ITEMS },
];
