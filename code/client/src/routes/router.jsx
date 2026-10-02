import { createBrowserRouter } from 'react-router-dom';
import MainLayout from '@/components/layout/MainLayout';
import HomePage from '@/pages/home/HomePage';
import MoviesPage from '@/pages/movies/MoviesPage';
import MovieDetailPage from '@/pages/movies/MovieDetailPage';
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
      { path: 'login', element: <LoginPage /> },
      { path: 'register', element: <RegisterPage /> },
      { path: '403', element: <ForbiddenPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
