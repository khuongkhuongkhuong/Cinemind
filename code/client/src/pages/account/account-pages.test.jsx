import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http } from 'msw';
import { setupServer } from 'msw/node';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext } from '@/context/AuthContext';
import { ToastProvider } from '@/components/ui/Toast';
import QrCode from '@/components/ui/QrCode';
import TicketsPage from './TicketsPage';
import TicketDetailPage from './TicketDetailPage';
import ProfilePage, { validatePassword, validateProfile } from './ProfilePage';
import { err, ok, renderPage } from '@/test/helpers';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

const showtime = {
  id: 'st1', startTime: '2999-10-02T12:45:00.000Z', format: 'F2D', audio: 'SUBTITLE',
  movie: { title: 'Phim thử', ageRating: 'T13', posterUrl: null }, cinema: { name: 'Rạp A' }, room: { name: 'Phòng 3' },
};
const summary = (n, extra = {}) => ({ id: `o${n}`, code: `CODE000${n}`, status: 'PAID', total: 195_000, createdAt: '2026-10-01T00:00:00Z', paidAt: '2026-10-01T00:01:00Z', checkedInAt: null, seatLabels: ['A1', 'D1'], showtime, ...extra });
const fullOrder = (extra = {}) => ({
  id: 'o1', code: 'K7Q2M9XA', status: 'PAID', expiresAt: '2026-10-01T00:10:00Z', showtime,
  seats: [{ seatId: 'A1', label: 'A1', type: 'STANDARD', price: 90_000 }, { seatId: 'D1', label: 'D1', type: 'VIP', price: 105_000 }],
  combos: [{ comboId: 'c1', name: 'Combo Solo', quantity: 2, unitPrice: 69_000, subtotal: 138_000 }], promotion: null,
  seatTotal: 195_000, comboTotal: 138_000, discount: 0, total: 333_000, paidAt: '2026-10-01T00:01:00Z', checkedInAt: null, qrContent: 'CINEMIND:K7Q2M9XA', ...extra,
});

// ----------------------------------------------------------------- QR
describe('QrCode', () => {
  it('vẽ ra SVG thật, đen trên nền trắng (đầu đọc QR cần tương phản), có tên truy cập', async () => {
    render(<QrCode value="CINEMIND:K7Q2M9XA" label="Mã QR của vé K7Q2M9XA" />);
    const box = await screen.findByRole('img', { name: 'Mã QR của vé K7Q2M9XA' });
    await waitFor(() => expect(box.querySelector('svg')).not.toBeNull());
    expect(box.innerHTML).toContain('#000000');
    expect(box.className).toMatch(/bg-white/);
  });
  it('nội dung khác nhau cho ra hình khác nhau', async () => {
    const { container, rerender } = render(<QrCode value="CINEMIND:AAAAAAAA" />);
    await waitFor(() => expect(container.querySelector('svg')).not.toBeNull());
    const first = container.innerHTML;
    rerender(<QrCode value="CINEMIND:BBBBBBBB" />);
    await waitFor(() => expect(container.innerHTML).not.toBe(first));
  });
});

// ------------------------------------------------------- P10 VÉ CỦA TÔI
describe('TicketsPage (P10)', () => {
  const routes = [{ path: '/me/tickets', element: <TicketsPage /> }];
  const backend = (items, meta) => {
    const seen = [];
    server.use(http.get('/api/v1/me/orders', ({ request }) => {
      seen.push(Object.fromEntries(new URL(request.url).searchParams));
      return ok(items, meta ?? { page: 1, pageSize: 10, total: items.length, totalPages: 1 });
    }));
    return seen;
  };

  it('mặc định hiện vé ĐÃ THANH TOÁN, kèm ghế, mã vé, tổng tiền, trạng thái "Chưa sử dụng"', async () => {
    const seen = backend([summary(1)]);
    renderPage(routes, '/me/tickets');
    expect(await screen.findByRole('heading', { name: 'Phim thử' })).toBeInTheDocument();
    expect(seen[0].status).toBe('PAID');
    expect(screen.getByText('A1, D1')).toBeInTheDocument();
    expect(screen.getByText('CODE-0001')).toBeInTheDocument();
    expect(screen.getByText('195.000đ')).toBeInTheDocument();
    expect(screen.getByText('Chưa sử dụng')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/me/tickets/CODE0001');
  });

  it('vé đã check-in hiện "Đã sử dụng"; vé của suất đã chiếu xong hiện "Suất đã chiếu"', async () => {
    backend([summary(1, { checkedInAt: '2026-10-02T12:00:00Z' }), summary(2, { showtime: { ...showtime, startTime: '2020-01-01T00:00:00Z' } })]);
    renderPage(routes, '/me/tickets');
    await screen.findAllByRole('heading', { name: 'Phim thử' });
    expect(screen.getByText('Đã sử dụng')).toBeInTheDocument();
    expect(screen.getByText('Suất đã chiếu')).toBeInTheDocument();
  });

  it('đơn đang chờ thanh toán dẫn về trang thanh toán (còn trong thời gian giữ ghế), không phải trang vé', async () => {
    backend([summary(1, { status: 'PENDING' })]);
    renderPage(routes, '/me/tickets?status=PENDING');
    await screen.findByRole('heading', { name: 'Phim thử' });
    const card = screen.getByRole('link');
    expect(within(card).getByText('Chờ thanh toán')).toBeInTheDocument();
    expect(card).toHaveAttribute('href', '/booking/orders/o1');
  });

  it('đổi bộ lọc trạng thái gửi đúng tham số và ghi lên URL; trạng thái lạ trên URL về mặc định', async () => {
    const seen = backend([summary(1, { status: 'CANCELLED' })]);
    const user = userEvent.setup();
    renderPage(routes, '/me/tickets?status=KHONG_CO');
    await screen.findByRole('heading', { name: 'Phim thử' });
    expect(seen[0].status).toBe('PAID');
    await user.selectOptions(screen.getByLabelText('Trạng thái'), 'CANCELLED');
    await waitFor(() => expect(seen.at(-1).status).toBe('CANCELLED'));
    expect(screen.getByTestId('where')).toHaveTextContent('status=CANCELLED');
  });

  it('chưa có vé: trạng thái rỗng có nút dẫn tới danh sách phim', async () => {
    backend([]);
    renderPage(routes, '/me/tickets');
    expect(await screen.findByText('Bạn chưa có vé nào')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Xem phim đang chiếu' })).toHaveAttribute('href', '/movies');
  });

  it('phân trang và lỗi máy chủ', async () => {
    const seen = backend([summary(1)], { page: 1, pageSize: 10, total: 25, totalPages: 3 });
    const user = userEvent.setup();
    renderPage(routes, '/me/tickets');
    await screen.findByRole('heading', { name: 'Phim thử' });
    await user.click(screen.getByRole('button', { name: 'Trang 2' }));
    await waitFor(() => expect(seen.at(-1).page).toBe('2'));
  });

  it('lỗi máy chủ: có nút thử lại', async () => {
    server.use(http.get('/api/v1/me/orders', () => err(500, 'INTERNAL_ERROR', 'x')));
    renderPage(routes, '/me/tickets');
    expect(await screen.findByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
  });
});

// ------------------------------------------------------- P11 CHI TIẾT VÉ
describe('TicketDetailPage (P11)', () => {
  const routes = [{ path: '/me/tickets/:code', element: <TicketDetailPage /> }];
  const backend = (order) => server.use(http.get('/api/v1/me/orders/:code', () => (order ? ok(order) : err(404, 'NOT_FOUND', 'Không tìm thấy vé.'))));

  it('⭐ đơn đã thanh toán: có mã QR (nội dung do server cấp), mã vé dạng K7Q2-M9XA, ghế, combo, tổng', async () => {
    backend(fullOrder());
    renderPage(routes, '/me/tickets/K7Q2M9XA');
    expect(await screen.findByRole('img', { name: 'Mã QR của vé K7Q2M9XA' })).toBeInTheDocument();
    expect(screen.getByTestId('ticket-code')).toHaveTextContent('K7Q2-M9XA');
    expect(screen.getByText('A1, D1')).toBeInTheDocument();
    expect(screen.getByText(/2 × Combo Solo/)).toBeInTheDocument();
    expect(screen.getByText(/Chưa sử dụng/)).toBeInTheDocument();
  });

  it('vé đã check-in: hiện "Đã sử dụng" kèm giờ', async () => {
    backend(fullOrder({ checkedInAt: '2026-10-02T12:32:10.000Z' }));
    renderPage(routes, '/me/tickets/K7Q2M9XA');
    expect(await screen.findByText(/Đã sử dụng/)).toHaveTextContent('19:32');
  });

  it('⭐ đơn CHƯA thanh toán / đã hủy: KHÔNG có mã QR, giải thích rõ', async () => {
    backend(fullOrder({ status: 'CANCELLED', qrContent: null }));
    renderPage(routes, '/me/tickets/K7Q2M9XA');
    expect(await screen.findByRole('note')).toHaveTextContent('đã hủy');
    expect(screen.queryByTestId('qr')).not.toBeInTheDocument();
  });

  it('đơn chờ thanh toán có nút "Tiếp tục thanh toán"; chờ hoàn tiền có lời giải thích', async () => {
    backend(fullOrder({ status: 'PENDING', qrContent: null }));
    const { unmount } = renderPage(routes, '/me/tickets/K7Q2M9XA');
    expect(await screen.findByRole('link', { name: 'Tiếp tục thanh toán' })).toHaveAttribute('href', '/booking/orders/o1');
    unmount();
    backend(fullOrder({ status: 'REFUND_PENDING', qrContent: null }));
    renderPage(routes, '/me/tickets/K7Q2M9XA');
    expect(await screen.findByText(/sẽ hoàn tiền cho bạn/)).toBeInTheDocument();
  });

  it('mã vé của người khác hoặc không tồn tại (NOT_FOUND): trang 404', async () => {
    backend(null);
    renderPage(routes, '/me/tickets/KHONGCO1');
    expect(await screen.findByText('Không tìm thấy trang')).toBeInTheDocument();
  });
});

// ------------------------------------------------------- P12 HỒ SƠ
describe('validateProfile / validatePassword', () => {
  it('hồ sơ', () => {
    expect(validateProfile({ fullName: 'An', phone: '' })).toEqual({});
    expect(validateProfile({ fullName: ' ', phone: '' }).fullName).toBeDefined();
    expect(validateProfile({ fullName: 'An', phone: '123' }).phone).toBeDefined();
    expect(validateProfile({ fullName: 'An', phone: '0912345678' })).toEqual({});
  });
  it('mật khẩu: thiếu, ngắn, trùng mật khẩu cũ, không khớp', () => {
    expect(validatePassword({ current: '', next: 'mat-khau-moi-1', confirm: 'mat-khau-moi-1' }).current).toBeDefined();
    expect(validatePassword({ current: 'cu-1234567', next: '1234567', confirm: '1234567' }).next).toMatch(/8 ký tự/);
    expect(validatePassword({ current: 'cu-1234567', next: 'cu-1234567', confirm: 'cu-1234567' }).next).toMatch(/khác/);
    expect(validatePassword({ current: 'cu-1234567', next: 'moi-1234567', confirm: 'khac' }).confirm).toMatch(/không khớp/);
    expect(validatePassword({ current: 'cu-1234567', next: 'moi-1234567', confirm: 'moi-1234567' })).toEqual({});
  });
});

describe('ProfilePage (P12)', () => {
  const user = { id: 'u1', email: 'a@b.co', fullName: 'Tên Cũ', phone: null, role: 'USER', points: 120 };
  function mount(updateUser = vi.fn()) {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <AuthContext.Provider value={{ status: 'authenticated', user, updateUser }}>
            <MemoryRouter><ProfilePage /></MemoryRouter>
          </AuthContext.Provider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    return updateUser;
  }

  it('hiện email (không sửa được) và điểm; lưu hồ sơ gửi ĐÚNG hai trường và cập nhật người dùng', async () => {
    let body;
    server.use(http.patch('/api/v1/me/profile', async ({ request }) => { body = await request.json(); return ok({ ...user, fullName: 'Tên Mới', phone: '0912345678' }); }));
    const updateUser = mount();
    const u = userEvent.setup();
    expect(screen.getByLabelText('Email')).toBeDisabled();
    expect(screen.getByText('120')).toBeInTheDocument();
    await u.clear(screen.getByLabelText('Họ và tên'));
    await u.type(screen.getByLabelText('Họ và tên'), '  Tên Mới ');
    await u.type(screen.getByLabelText('Số điện thoại'), '0912345678');
    await u.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith(expect.objectContaining({ fullName: 'Tên Mới' })));
    expect(body).toEqual({ fullName: 'Tên Mới', phone: '0912345678' }); // không gửi email / role / points
    expect(await screen.findByText('Đã lưu hồ sơ.')).toBeInTheDocument();
  });

  it('xóa số điện thoại: gửi phone = null', async () => {
    let body;
    server.use(http.patch('/api/v1/me/profile', async ({ request }) => { body = await request.json(); return ok({ ...user }); }));
    mount();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(body).toEqual({ fullName: 'Tên Cũ', phone: null }));
  });

  it('dữ liệu sai: báo ngay ở ô, KHÔNG gọi server', async () => {
    let called = false;
    server.use(http.patch('/api/v1/me/profile', () => { called = true; return ok(user); }));
    mount();
    const u = userEvent.setup();
    await u.type(screen.getByLabelText('Số điện thoại'), '123');
    await u.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    expect(screen.getByText(/10 chữ số/)).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it('⭐ đổi mật khẩu thành công: gửi currentPassword/newPassword, xóa trắng các ô, báo các thiết bị khác bị đăng xuất', async () => {
    let body;
    server.use(http.put('/api/v1/me/password', async ({ request }) => { body = await request.json(); return new Response(null, { status: 204 }); }));
    mount();
    const u = userEvent.setup();
    await u.type(screen.getByLabelText('Mật khẩu hiện tại'), 'mat-khau-cu-1');
    await u.type(screen.getByLabelText('Mật khẩu mới'), 'mat-khau-moi-9');
    await u.type(screen.getByLabelText('Nhập lại mật khẩu mới'), 'mat-khau-moi-9');
    await u.click(screen.getByRole('button', { name: 'Đổi mật khẩu' }));
    expect(await screen.findByText(/Các thiết bị khác đã bị đăng xuất/)).toBeInTheDocument();
    expect(body).toEqual({ currentPassword: 'mat-khau-cu-1', newPassword: 'mat-khau-moi-9' });
    expect(screen.getByLabelText('Mật khẩu hiện tại')).toHaveValue('');
    expect(screen.getByLabelText('Mật khẩu mới')).toHaveValue('');
  });

  it('⭐ sai mật khẩu hiện tại (400, không phải 401): lỗi hiện ngay dưới ô đó và ô được xóa', async () => {
    server.use(http.put('/api/v1/me/password', () => err(400, 'VALIDATION_ERROR', 'x', { fields: { currentPassword: 'Mật khẩu hiện tại không đúng.' } })));
    mount();
    const u = userEvent.setup();
    await u.type(screen.getByLabelText('Mật khẩu hiện tại'), 'sai-roi-nha');
    await u.type(screen.getByLabelText('Mật khẩu mới'), 'mat-khau-moi-9');
    await u.type(screen.getByLabelText('Nhập lại mật khẩu mới'), 'mat-khau-moi-9');
    await u.click(screen.getByRole('button', { name: 'Đổi mật khẩu' }));
    expect(await screen.findByText('Mật khẩu hiện tại không đúng.')).toBeInTheDocument();
    expect(screen.getByLabelText('Mật khẩu hiện tại')).toHaveValue('');
    expect(screen.getByLabelText('Mật khẩu mới')).toHaveValue('mat-khau-moi-9'); // giữ lại để người dùng đỡ gõ lại
  });
});
