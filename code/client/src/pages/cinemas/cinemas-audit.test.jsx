import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http } from 'msw';
import { setupServer } from 'msw/node';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CinemasPage from './CinemasPage';
import CinemaDetailPage from './CinemaDetailPage';
import AdminCinemasPage from '../admin/AdminCinemasPage';
import AdminAuditPage from '../admin/AdminAuditPage';
import { err, ok, renderPage } from '@/test/helpers';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

const API = '/api/v1';
const cities = [{ id: 'ct1', name: 'Hà Nội' }, { id: 'ct2', name: 'Đà Nẵng' }];

describe('CinemasPage (P04)', () => {
  it('nhóm rạp theo thành phố, bỏ thành phố không có rạp, link tới lịch chiếu', async () => {
    server.use(
      http.get(`${API}/cities`, () => ok(cities)),
      http.get(`${API}/cinemas`, () => ok([{ id: 'c1', name: 'Rạp A', address: '1 X', cityId: 'ct1' }])),
    );
    renderPage([{ path: '/cinemas', element: <CinemasPage /> }], '/cinemas');
    expect(await screen.findByRole('heading', { name: 'Hà Nội' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Đà Nẵng' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Rạp A/ })).toHaveAttribute('href', '/cinemas/c1');
  });
});

describe('CinemaDetailPage (P04)', () => {
  const schedule = {
    date: '2030-01-01', cinema: { id: 'c1', name: 'Rạp A', address: '1 Đường X' },
    movies: [{
      movie: { id: 'm1', title: 'Phim thử', slug: 'phim-thu', ageRating: 'T13', posterUrl: null, durationMin: 100 },
      groups: [{ format: 'F2D', audio: 'SUBTITLE', showtimes: [{ id: 's1', startTime: '2030-01-01T11:30:00.000Z', isOpenForSale: true }, { id: 's2', startTime: '2030-01-01T05:00:00.000Z', isOpenForSale: false }] }],
    }],
  };
  it('hiện lịch theo phim; suất mở bán là link chọn ghế, suất đã đóng bán không bấm được', async () => {
    server.use(http.get(`${API}/cinemas/c1/showtimes`, () => ok(schedule)));
    renderPage([{ path: '/cinemas/:id', element: <CinemaDetailPage /> }], '/cinemas/c1');
    expect(await screen.findByRole('heading', { name: 'Rạp A' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Phim thử' })).toHaveAttribute('href', '/movies/phim-thu');
    expect(screen.getByRole('link', { name: /Chọn suất/ })).toHaveAttribute('href', '/booking/showtimes/s1');
    expect(screen.getByLabelText(/đã đóng bán/)).toBeInTheDocument();
  });
  it('rạp không có / đã tắt (404 NOT_FOUND): hiện trang 404', async () => {
    server.use(http.get(`${API}/cinemas/zzz/showtimes`, () => err(404, 'NOT_FOUND', 'x')));
    renderPage([{ path: '/cinemas/:id', element: <CinemaDetailPage /> }], '/cinemas/zzz');
    expect(await screen.findByText('Không tìm thấy trang')).toBeInTheDocument();
  });
  it('ngày không có suất: báo trống', async () => {
    server.use(http.get(`${API}/cinemas/c1/showtimes`, () => ok({ ...schedule, movies: [] })));
    renderPage([{ path: '/cinemas/:id', element: <CinemaDetailPage /> }], '/cinemas/c1');
    expect(await screen.findByText('Chưa có suất chiếu')).toBeInTheDocument();
  });
});

describe('AdminCinemasPage — thêm / sửa rạp', () => {
  const cinema = { id: 'c1', name: 'Rạp A', address: '1 X', phone: null, isActive: true, city: { id: 'ct1', name: 'Hà Nội' }, rooms: [] };
  const use = (extra = []) => server.use(http.get(`${API}/cities`, () => ok(cities)), http.get(`${API}/admin/cinemas`, () => ok([cinema])), ...extra);

  it('thêm rạp: gửi đúng body, sđt trống là null', async () => {
    let body;
    use([http.post(`${API}/admin/cinemas`, async ({ request }) => { body = await request.json(); return ok({ ...cinema, id: 'c2' }); })]);
    const user = userEvent.setup();
    renderPage([{ path: '/', element: <AdminCinemasPage /> }], '/');
    await user.click(await screen.findByRole('button', { name: '+ Thêm rạp' }));
    await user.selectOptions(await screen.findByLabelText('Thành phố'), 'ct2');
    await user.type(screen.getByLabelText('Tên rạp'), 'Rạp mới');
    await user.type(screen.getByLabelText('Địa chỉ'), '2 Đường Y');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(body).toEqual({ cityId: 'ct2', name: 'Rạp mới', address: '2 Đường Y', phone: null, isActive: true }));
  });

  it('⭐ tắt rạp còn suất đã bán (409 RESOURCE_IN_USE): hộp thoại giữ nguyên và hiện lời giải thích của server', async () => {
    use([http.put(`${API}/admin/cinemas/c1`, () => err(409, 'RESOURCE_IN_USE', 'Rạp còn suất sắp chiếu đã có người đặt vé.'))]);
    const user = userEvent.setup();
    renderPage([{ path: '/', element: <AdminCinemasPage /> }], '/');
    await user.click(await screen.findByRole('button', { name: 'Sửa Rạp A' }));
    await user.click(await screen.findByLabelText('Đang hoạt động'));
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Rạp còn suất sắp chiếu đã có người đặt vé.')).toBeInTheDocument();
    expect(screen.getByLabelText('Tên rạp')).toHaveValue('Rạp A');
  });

  it('rạp đã tắt có nhãn "Đã tắt"; rạp chưa có phòng báo rõ', async () => {
    server.use(http.get(`${API}/admin/cinemas`, () => ok([{ ...cinema, isActive: false }])));
    renderPage([{ path: '/', element: <AdminCinemasPage /> }], '/');
    expect(await screen.findByText('Đã tắt')).toBeInTheDocument();
    expect(screen.getByText('Chưa có phòng chiếu.')).toBeInTheDocument();
  });
});

describe('AdminAuditPage (A11)', () => {
  const rows = [
    { id: 'l1', createdAt: '2026-10-02T03:00:00.000Z', action: 'PATCH /admin/users/:id', entityType: 'users', entityId: '12345678-aaaa-bbbb-cccc-000000000000', actor: { id: 'a', fullName: 'Admin Một', email: 'a@x.vn' }, details: { fields: ['role'], values: { role: 'ADMIN' } } },
    { id: 'l2', createdAt: '2026-10-02T02:00:00.000Z', action: 'POST /admin/cinemas', entityType: 'cinemas', entityId: null, actor: null, details: { fields: ['name'] } },
  ];
  it('hiện người thực hiện, nhãn tiếng Việt, giá trị an toàn; tài khoản đã xóa hiện rõ', async () => {
    server.use(http.get(`${API}/admin/audit-logs`, () => ok(rows, { page: 1, pageSize: 20, total: 2, totalPages: 1 })));
    renderPage([{ path: '/', element: <AdminAuditPage /> }], '/');
    expect(await screen.findByText('Sửa tài khoản')).toBeInTheDocument();
    expect(screen.getByText('Admin Một')).toBeInTheDocument();
    expect(screen.getByText('role = ADMIN')).toBeInTheDocument();
    expect(screen.getByText('(tài khoản đã xóa)')).toBeInTheDocument();
    expect(screen.getByText('Thêm rạp')).toBeInTheDocument();
  });
  it('lọc theo đối tượng gửi entityType lên server', async () => {
    const seen = [];
    server.use(http.get(`${API}/admin/audit-logs`, ({ request }) => { seen.push(new URL(request.url).searchParams.get('entityType')); return ok(rows, { page: 1, pageSize: 20, total: 2, totalPages: 1 }); }));
    const user = userEvent.setup();
    renderPage([{ path: '/', element: <AdminAuditPage /> }], '/');
    await user.selectOptions(await screen.findByLabelText('Đối tượng'), 'users');
    await waitFor(() => expect(seen).toContain('users'));
  });
  it('chưa có nhật ký: báo trống', async () => {
    server.use(http.get(`${API}/admin/audit-logs`, () => ok([], { page: 1, pageSize: 20, total: 0, totalPages: 0 })));
    renderPage([{ path: '/', element: <AdminAuditPage /> }], '/');
    expect(await screen.findByText('Chưa có thao tác nào được ghi lại')).toBeInTheDocument();
  });
});
