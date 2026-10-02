import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http } from 'msw';
import { setupServer } from 'msw/node';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminDashboardPage from './AdminDashboardPage';
import AdminCombosPage from './AdminCombosPage';
import AdminPromotionsPage from './AdminPromotionsPage';
import AdminBannersPage from './AdminBannersPage';
import AdminUsersPage from './AdminUsersPage';
import { err, ok, renderPage } from '@/test/helpers';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'me', role: 'ADMIN', fullName: 'Admin', email: 'admin@x.vn' } }) }));

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

const A = '/api/v1/admin';
const meta = { page: 1, pageSize: 15, total: 2, totalPages: 1 };
const page = (el) => renderPage([{ path: '/', element: el }], '/');

describe('AdminDashboardPage (A01)', () => {
  const rows = [
    { key: '2026-10-01', label: '2026-10-01', revenue: 200000, ticketCount: 2, orderCount: 1 },
    { key: '2026-10-02', label: '2026-10-02', revenue: 0, ticketCount: 0, orderCount: 0 },
  ];
  it('hiện tổng doanh thu / vé / đơn và gửi groupBy đúng; đổi nhóm thì gọi lại', async () => {
    const seen = [];
    server.use(http.get(`${A}/reports/revenue`, ({ request }) => { seen.push(new URL(request.url).searchParams.get('groupBy')); return ok(rows); }));
    const user = userEvent.setup();
    page(<AdminDashboardPage />);
    expect(await screen.findByText('200.000đ')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Biểu đồ doanh thu 2 ngày/ })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Nhóm'), 'movie');
    await waitFor(() => expect(seen).toContain('movie'));
  });
  it('không có doanh thu: báo trống thay vì biểu đồ rỗng', async () => {
    server.use(http.get(`${A}/reports/revenue`, () => ok([{ ...rows[1] }])));
    page(<AdminDashboardPage />);
    expect(await screen.findByText('Chưa có doanh thu trong khoảng này')).toBeInTheDocument();
  });
  it('lỗi server: hiện nút thử lại', async () => {
    server.use(http.get(`${A}/reports/revenue`, () => err(500, 'INTERNAL_ERROR', 'Lỗi')));
    page(<AdminDashboardPage />);
    expect(await screen.findByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
  });
});

describe('AdminCombosPage (A07)', () => {
  const combo = { id: 'c1', name: 'Combo 1', description: 'Bắp + nước', price: 89000, imageUrl: null, isActive: true };
  it('thêm combo gửi đúng body', async () => {
    let body;
    server.use(
      http.get(`${A}/combos`, () => ok([combo])),
      http.post(`${A}/combos`, async ({ request }) => { body = await request.json(); return ok(combo); }),
    );
    const user = userEvent.setup();
    page(<AdminCombosPage />);
    await user.click(await screen.findByRole('button', { name: '+ Thêm combo' }));
    await user.type(screen.getByLabelText('Tên combo'), 'Combo mới');
    await user.type(screen.getByLabelText('Giá (VND)'), '99000');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(body).toEqual({ name: 'Combo mới', description: null, price: 99000, imageUrl: null, isActive: true }));
  });
  it('xóa combo đã có trong đơn: gợi ý tắt "Đang bán"', async () => {
    server.use(http.get(`${A}/combos`, () => ok([combo])), http.delete(`${A}/combos/c1`, () => err(409, 'RESOURCE_IN_USE', 'x')));
    const user = userEvent.setup();
    page(<AdminCombosPage />);
    await user.click(await screen.findByRole('button', { name: 'Xóa Combo 1' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Xóa' }));
    expect(await screen.findByText(/bỏ chọn "Đang bán"/)).toBeInTheDocument();
  });
});

describe('AdminPromotionsPage (A08)', () => {
  const promo = {
    id: 'p1', code: 'SALE10', name: 'Giảm 10%', description: null, discountType: 'PERCENT', discountValue: 10, maxDiscount: 30000, minOrderValue: 0,
    startAt: '2030-01-01T00:00:00.000Z', endAt: '2030-02-01T00:00:00.000Z', usageLimit: 100, usedCount: 7, isActive: true,
  };
  it('hiện mô tả mức giảm và lượt dùng', async () => {
    server.use(http.get(`${A}/promotions`, () => ok([promo])));
    page(<AdminPromotionsPage />);
    expect(await screen.findByText(/Giảm 10% \(tối đa 30\.000đ\)/)).toBeInTheDocument();
    expect(screen.getByText('7 / 100')).toBeInTheDocument();
  });
  it('⭐ sửa: mã bị khóa và PUT KHÔNG gửi code', async () => {
    let body;
    server.use(
      http.get(`${A}/promotions`, () => ok([promo])),
      http.put(`${A}/promotions/p1`, async ({ request }) => { body = await request.json(); return ok(promo); }),
    );
    const user = userEvent.setup();
    page(<AdminPromotionsPage />);
    await user.click(await screen.findByRole('button', { name: 'Sửa SALE10' }));
    expect(screen.getByLabelText('Mã')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body).not.toHaveProperty('code');
    expect(body.startAt).toBe('2030-01-01T00:00:00.000Z');
  });
  it('tạo mã: kết thúc trước bắt đầu bị chặn, không gửi request', async () => {
    let posts = 0;
    server.use(http.get(`${A}/promotions`, () => ok([])), http.post(`${A}/promotions`, () => { posts += 1; return ok(promo); }));
    const user = userEvent.setup();
    page(<AdminPromotionsPage />);
    await user.click(await screen.findByRole('button', { name: '+ Thêm khuyến mãi' }));
    await user.type(screen.getByLabelText(/^Mã \(khách sẽ nhập\)/), 'tet2030');
    await user.type(screen.getByLabelText('Tên chương trình'), 'Tết');
    await user.type(screen.getByLabelText('Giá trị giảm (%)'), '10');
    await user.type(screen.getByLabelText('Bắt đầu (giờ Việt Nam)'), '2030-02-01T10:00');
    await user.type(screen.getByLabelText('Kết thúc (giờ Việt Nam)'), '2030-01-01T10:00');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Kết thúc phải sau bắt đầu')).toBeInTheDocument();
    expect(posts).toBe(0);
  });
});

describe('AdminBannersPage (A10)', () => {
  it('⭐ URL liên kết "//evil.com" bị chặn ở trình duyệt, không gửi request', async () => {
    let posts = 0;
    server.use(http.get(`${A}/banners`, () => ok([])), http.post(`${A}/banners`, () => { posts += 1; return ok({}); }));
    const user = userEvent.setup();
    page(<AdminBannersPage />);
    await user.click(await screen.findByRole('button', { name: '+ Thêm banner' }));
    await user.type(screen.getByLabelText('Tiêu đề'), 'Tết');
    await user.type(screen.getByLabelText('URL ảnh'), '/banners/tet.jpg');
    await user.type(screen.getByLabelText(/Liên kết khi bấm/), '//evil.com');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText(/Phải là URL http\(s\)/)).toBeInTheDocument();
    expect(posts).toBe(0);
  });
  it('thêm banner hợp lệ gửi thời gian trống là null', async () => {
    let body;
    server.use(http.get(`${A}/banners`, () => ok([])), http.post(`${A}/banners`, async ({ request }) => { body = await request.json(); return ok({}); }));
    const user = userEvent.setup();
    page(<AdminBannersPage />);
    await user.click(await screen.findByRole('button', { name: '+ Thêm banner' }));
    await user.type(screen.getByLabelText('Tiêu đề'), 'Tết');
    await user.type(screen.getByLabelText('URL ảnh'), 'https://cdn.x/a.jpg');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(body).toMatchObject({ title: 'Tết', linkUrl: null, startAt: null, endAt: null }));
  });
});

describe('AdminUsersPage (A09)', () => {
  const users = [
    { id: 'me', email: 'admin@x.vn', fullName: 'Admin', phone: null, role: 'ADMIN', points: 0, isActive: true, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'u2', email: 'khach@x.vn', fullName: 'Khách', phone: null, role: 'USER', points: 5, isActive: true, createdAt: '2026-02-01T00:00:00.000Z' },
  ];
  it('⭐ chính mình: không đổi được vai trò, không có nút Khóa', async () => {
    server.use(http.get(`${A}/users`, () => ok(users, meta)));
    page(<AdminUsersPage />);
    expect(await screen.findByLabelText('Vai trò của admin@x.vn')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Khóa admin@x.vn' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Khóa khach@x.vn' })).toBeInTheDocument();
  });
  it('⭐ nâng lên ADMIN phải qua hộp xác nhận; chưa xác nhận thì chưa gọi API', async () => {
    let body; let patches = 0;
    server.use(
      http.get(`${A}/users`, () => ok(users, meta)),
      http.patch(`${A}/users/u2`, async ({ request }) => { patches += 1; body = await request.json(); return ok(users[1]); }),
    );
    const user = userEvent.setup();
    page(<AdminUsersPage />);
    await user.selectOptions(await screen.findByLabelText('Vai trò của khach@x.vn'), 'ADMIN');
    expect(await screen.findByText(/toàn quyền hệ thống/)).toBeInTheDocument();
    expect(patches).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => expect(body).toEqual({ role: 'ADMIN' }));
  });
  it('khóa tài khoản: xác nhận rồi gửi isActive=false; lỗi FORBIDDEN hiện message của server', async () => {
    let body;
    server.use(
      http.get(`${A}/users`, () => ok(users, meta)),
      http.patch(`${A}/users/u2`, async ({ request }) => { body = await request.json(); return err(403, 'FORBIDDEN', 'Hệ thống phải còn ít nhất một quản trị viên đang hoạt động.'); }),
    );
    const user = userEvent.setup();
    page(<AdminUsersPage />);
    await user.click(await screen.findByRole('button', { name: 'Khóa khach@x.vn' }));
    await user.click(screen.getByRole('button', { name: 'Xác nhận' }));
    expect(await screen.findByText(/còn ít nhất một quản trị viên/)).toBeInTheDocument();
    expect(body).toEqual({ isActive: false });
  });
  it('thêm nhân viên: body không có role; email trùng báo ngay ở ô email', async () => {
    let body;
    server.use(
      http.get(`${A}/users`, () => ok(users, meta)),
      http.post(`${A}/users`, async ({ request }) => { body = await request.json(); return err(409, 'EMAIL_EXISTS', 'x'); }),
    );
    const user = userEvent.setup();
    page(<AdminUsersPage />);
    await user.click(await screen.findByRole('button', { name: '+ Thêm nhân viên' }));
    await user.type(screen.getByLabelText('Họ tên'), 'NV A');
    await user.type(screen.getByLabelText('Email'), 'nv@x.vn');
    await user.type(screen.getByLabelText('Mật khẩu tạm'), '12345678');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Email này đã được đăng ký')).toBeInTheDocument();
    expect(body).not.toHaveProperty('role');
  });
});
