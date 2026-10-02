import { createBrowserRouter } from 'react-router-dom';
import MainLayout from '@/components/layout/MainLayout';
import HomePage from '@/pages/home/HomePage';
import MoviesPage from '@/pages/movies/MoviesPage';
import MovieDetailPage from '@/pages/movies/MovieDetailPage';
import SeatSelectionPage from '@/pages/booking/SeatSelectionPage';
import CheckoutPage from '@/pages/booking/CheckoutPage';
import PaymentResultPage from '@/pages/booking/PaymentResultPage';
import TicketsPage from '@/pages/account/TicketsPage';
import TicketDetailPage from '@/pages/account/TicketDetailPage';
import ProfilePage from '@/pages/account/ProfilePage';
import StaffCheckInPage from '@/pages/staff/StaffCheckInPage';
import AdminLayout from '@/components/admin/AdminLayout';
import AdminDashboardPage from '@/pages/admin/AdminDashboardPage';
import AdminCombosPage from '@/pages/admin/AdminCombosPage';
import AdminPromotionsPage from '@/pages/admin/AdminPromotionsPage';
import AdminBannersPage from '@/pages/admin/AdminBannersPage';
import AdminUsersPage from '@/pages/admin/AdminUsersPage';
import AdminAuditPage from '@/pages/admin/AdminAuditPage';
import CinemasPage from '@/pages/cinemas/CinemasPage';
import CinemaDetailPage from '@/pages/cinemas/CinemaDetailPage';
import AdminMoviesPage from '@/pages/admin/AdminMoviesPage';
import AdminShowtimesPage from '@/pages/admin/AdminShowtimesPage';
import AdminCinemasPage from '@/pages/admin/AdminCinemasPage';
import AdminPricingPage from '@/pages/admin/AdminPricingPage';
import AdminOrdersPage from '@/pages/admin/AdminOrdersPage';
import RequireAuth from './RequireAuth';
import RequireRole from './RequireRole';
import LoginPage from '@/pages/auth/LoginPage';
import RegisterPage from '@/pages/auth/RegisterPage';
import { ForbiddenPage, NotFoundPage } from '@/pages/common/StatusPages';

// Khai báo toàn bộ route của khách hàng (05-ui-pages.md). Các nhóm có đăng nhập sẽ bọc bằng <RequireAuth /> khi thêm trang.
export const routes = [
  {
    element: <MainLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'movies', element: <MoviesPage /> },
      { path: 'movies/:slug', element: <MovieDetailPage /> },
      { path: 'cinemas', element: <CinemasPage /> },
      { path: 'cinemas/:id', element: <CinemaDetailPage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'register', element: <RegisterPage /> },
      {
        element: <RequireAuth />, // luồng đặt vé cần đăng nhập; chưa đăng nhập -> /login?returnUrl=... rồi quay lại đúng trang
        children: [
          { path: 'booking/showtimes/:showtimeId', element: <SeatSelectionPage /> },
          { path: 'booking/orders/:orderId', element: <CheckoutPage /> },
          { path: 'payment/result', element: <PaymentResultPage /> },
          { path: 'me/tickets', element: <TicketsPage /> },
          { path: 'me/tickets/:code', element: <TicketDetailPage /> },
          { path: 'me/profile', element: <ProfilePage /> },
          {
            element: <RequireRole roles={['STAFF', 'ADMIN']} />, // ADMIN được coi là STAFF; quyền thật do server kiểm tra
            children: [{ path: 'staff/check-in', element: <StaffCheckInPage /> }],
          },
        ],
      },
      { path: '403', element: <ForbiddenPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

// Khu quản trị: khung riêng (không dùng MainLayout). Quyền thật do server kiểm tra ở mỗi request /admin/*.
export const adminRoutes = [
  {
    element: <RequireAuth />,
    children: [{
      element: <RequireRole roles={['ADMIN']} />,
      children: [{
        path: 'admin',
        element: <AdminLayout />,
        children: [
          { index: true, element: <AdminDashboardPage /> },
          { path: 'combos', element: <AdminCombosPage /> },
          { path: 'promotions', element: <AdminPromotionsPage /> },
          { path: 'banners', element: <AdminBannersPage /> },
          { path: 'users', element: <AdminUsersPage /> },
          { path: 'audit', element: <AdminAuditPage /> },
          { path: 'movies', element: <AdminMoviesPage /> },
          { path: 'showtimes', element: <AdminShowtimesPage /> },
          { path: 'cinemas', element: <AdminCinemasPage /> },
          { path: 'pricing', element: <AdminPricingPage /> },
          { path: 'orders', element: <AdminOrdersPage /> },
        ],
      }],
    }],
  },
];

export const router = createBrowserRouter([...routes, ...adminRoutes]);
