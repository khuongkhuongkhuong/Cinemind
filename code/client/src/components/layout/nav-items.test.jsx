import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import NavDropdown from './NavDropdown';
import { NAV } from './navItems';
import Footer from './Footer';
import CinemasPage from '@/pages/cinemas/CinemasPage';

const ok = (data) => HttpResponse.json({ success: true, data });
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

const wrap = (ui, path = '/') => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
  </QueryClientProvider>,
);
const cities = [{ id: 'hn', name: 'Hà Nội' }, { id: 'dn', name: 'Đà Nẵng' }];
const cinemas = [{ id: 'c1', cityId: 'hn', name: 'Rạp A', address: '1' }, { id: 'c2', cityId: 'dn', name: 'Rạp B', address: '2' }];
const entry = (label) => NAV.find((n) => n.label === label);
const href = (name) => screen.getByRole('link', { name }).getAttribute('href');

describe('Menu con của thanh điều hướng', () => {
  it('Phim: đang chiếu / sắp chiếu dùng đúng tham số trang danh sách hiểu (now | soon)', async () => {
    wrap(<NavDropdown {...entry('Phim')} />);
    await userEvent.setup().hover(screen.getByRole('link', { name: 'Phim' }));
    expect(href('Phim đang chiếu')).toBe('/movies?status=now');
    expect(href('Phim sắp chiếu')).toBe('/movies?status=soon');
  });

  it('⭐ Rạp: chỉ tải danh sách thành phố KHI mở menu, rồi liệt kê từng thành phố', async () => {
    let calls = 0;
    server.use(http.get('/api/v1/cities', () => { calls += 1; return ok(cities); }));
    wrap(<NavDropdown {...entry('Rạp Cinemind')} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toBe(0);
    await userEvent.setup().hover(screen.getByRole('link', { name: 'Rạp Cinemind' }));
    expect(await screen.findByRole('link', { name: 'Rạp tại Đà Nẵng' })).toHaveAttribute('href', '/cinemas?city=dn');
    expect(href('Tất cả các rạp')).toBe('/cinemas');
  });

  it('chân trang dẫn đúng tới phim sắp chiếu', () => {
    wrap(<Footer />);
    expect(href('Phim sắp chiếu')).toBe('/movies?status=soon');
    expect(href('Phim đang chiếu')).toBe('/movies?status=now');
  });
});

describe('CinemasPage lọc theo thành phố trên URL', () => {
  const page = (path) => {
    server.use(http.get('/api/v1/cities', () => ok(cities)), http.get('/api/v1/cinemas', () => ok(cinemas)));
    wrap(<Routes><Route path="/cinemas" element={<CinemasPage />} /></Routes>, path);
  };

  it('?city=dn chỉ hiện rạp Đà Nẵng và có đường quay lại tất cả', async () => {
    page('/cinemas?city=dn');
    expect(await screen.findByText('Rạp B')).toBeInTheDocument();
    expect(screen.queryByText('Rạp A')).not.toBeInTheDocument();
    expect(href('← Xem tất cả các rạp')).toBe('/cinemas');
  });

  it('mã thành phố lạ thì hiện tất cả', async () => {
    page('/cinemas?city=khong-co');
    expect(await screen.findByText('Rạp A')).toBeInTheDocument();
    expect(screen.getByText('Rạp B')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Xem tất cả các rạp/ })).not.toBeInTheDocument();
  });
});
