// Xác minh email (P15) và quên mật khẩu (P16).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http } from 'msw';
import { setupServer } from 'msw/node';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthContext } from '@/context/AuthContext';
import { useState } from 'react';
import VerifyEmailPage from './VerifyEmailPage';
import ForgotPasswordPage from './ForgotPasswordPage';
import VerifyBanner from '@/components/layout/VerifyBanner';
import { err, ok, renderPage } from '@/test/helpers';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

const API = '/api/v1/auth';
const unverified = { id: 'u1', email: 'a@x.vn', fullName: 'A', role: 'USER', emailVerified: false };

/** Vẽ trang trong ngữ cảnh đăng nhập giả: `updateUser` cập nhật người dùng như thật. */
function Signed({ user: initial, children }) {
  const [user, setUser] = useState(initial);
  return <AuthContext.Provider value={{ status: 'authenticated', user, updateUser: setUser }}>{children}</AuthContext.Provider>;
}
const openVerify = (path = '/verify-email', user = unverified) => {
  const u = userEvent.setup();
  renderPage([
    { path: '/verify-email', element: <Signed user={user}><VerifyBanner /><VerifyEmailPage /></Signed> },
    { path: '*', element: <p>Trang khác</p> },
  ], path);
  return u;
};

describe('VerifyEmailPage (P15)', () => {
  it('⭐ nhập đúng mã: gửi đúng body rồi quay lại returnUrl', async () => {
    let body;
    server.use(http.post(`${API}/verify-email`, async ({ request }) => { body = await request.json(); return ok({ ...unverified, emailVerified: true }); }));
    const user = openVerify('/verify-email?returnUrl=%2Fbooking%2Fshowtimes%2Fs1');
    await user.type(screen.getByLabelText('Mã 6 số'), '12 34-56abc');
    expect(screen.getByLabelText('Mã 6 số')).toHaveValue('123456'); // chỉ giữ chữ số
    await user.click(screen.getByRole('button', { name: 'Xác minh' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/booking/showtimes/s1'));
    expect(body).toEqual({ code: '123456' });
  });

  it('mã sai: hiện lời của server, xóa ô nhập; thiếu số thì không gọi server', async () => {
    let calls = 0;
    server.use(http.post(`${API}/verify-email`, () => { calls += 1; return err(422, 'CODE_INVALID', 'Mã không đúng. Bạn còn 4 lần nhập.', { attemptsLeft: 4 }); }));
    const user = openVerify();
    await user.type(screen.getByLabelText('Mã 6 số'), '123');
    await user.click(screen.getByRole('button', { name: 'Xác minh' }));
    expect(screen.getByText('Nhập đủ 6 chữ số')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Mã 6 số'), '456');
    await user.click(screen.getByRole('button', { name: 'Xác minh' }));
    expect(await screen.findByText('Mã không đúng. Bạn còn 4 lần nhập.')).toBeInTheDocument();
    expect(screen.getByLabelText('Mã 6 số')).toHaveValue('');
    expect(calls).toBe(1);
  });

  it('gửi lại mã: nút khóa kèm đếm ngược; server bảo chờ (429) thì đếm theo server', async () => {
    server.use(http.post(`${API}/resend-code`, () => err(429, 'RATE_LIMITED', 'Vui lòng đợi 42 giây rồi xin mã mới.', { retryAfterSec: 42 })));
    const user = openVerify();
    await user.click(screen.getByRole('button', { name: 'Gửi lại mã' }));
    expect(await screen.findByRole('button', { name: /Gửi lại mã sau 4\d giây/ })).toBeDisabled();
    expect(screen.getByText('Vui lòng đợi 42 giây rồi xin mã mới.')).toBeInTheDocument();
  });

  it('đã xác minh rồi thì không ở lại trang này; returnUrl ra ngoài trang bị bỏ qua', async () => {
    openVerify('/verify-email?returnUrl=https%3A%2F%2Fgia-mao.com', { ...unverified, emailVerified: true });
    expect(await screen.findByText('Trang khác')).toBeInTheDocument();
    expect(screen.getByTestId('where').textContent).toBe('/');
  });
});

describe('ForgotPasswordPage (P16)', () => {
  const open = () => {
    const user = userEvent.setup();
    renderPage([{ path: '/forgot-password', element: <ForgotPasswordPage /> }, { path: '/login', element: <p>Trang đăng nhập</p> }], '/forgot-password');
    return user;
  };

  it('⭐ xin mã rồi đặt mật khẩu mới; không khẳng định email có tồn tại', async () => {
    const bodies = [];
    server.use(
      http.post(`${API}/forgot-password`, async ({ request }) => { bodies.push(await request.json()); return ok({ sent: true }); }),
      http.post(`${API}/reset-password`, async ({ request }) => { bodies.push(await request.json()); return ok({ reset: true }); }),
    );
    const user = open();
    await user.type(screen.getByLabelText('Email'), '  a@x.vn ');
    await user.click(screen.getByRole('button', { name: 'Gửi mã' }));
    expect(await screen.findByText(/Nếu a@x.vn đã đăng ký thì mã 6 số đã được gửi/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Mã 6 số'), '654321');
    await user.type(screen.getByLabelText('Mật khẩu mới'), 'mat-khau-moi');
    await user.type(screen.getByLabelText('Nhập lại mật khẩu mới'), 'mat-khau-moi');
    await user.click(screen.getByRole('button', { name: 'Đặt mật khẩu mới' }));
    expect(await screen.findByText('Trang đăng nhập')).toBeInTheDocument();
    expect(bodies).toEqual([{ email: 'a@x.vn' }, { email: 'a@x.vn', code: '654321', newPassword: 'mat-khau-moi' }]);
  });

  it('mật khẩu nhập lại không khớp / quá ngắn: chặn ở trình duyệt; mã sai: hiện lỗi và ở lại', async () => {
    let resets = 0;
    server.use(
      http.post(`${API}/forgot-password`, () => ok({ sent: true })),
      http.post(`${API}/reset-password`, () => { resets += 1; return err(422, 'CODE_INVALID', 'Mã không đúng hoặc đã hết hạn.'); }),
    );
    const user = open();
    await user.type(screen.getByLabelText('Email'), 'a@x.vn');
    await user.click(screen.getByRole('button', { name: 'Gửi mã' }));
    await user.type(await screen.findByLabelText('Mã 6 số'), '000000');
    await user.type(screen.getByLabelText('Mật khẩu mới'), 'ngan');
    await user.click(screen.getByRole('button', { name: 'Đặt mật khẩu mới' }));
    expect(screen.getByText('Mật khẩu tối thiểu 8 ký tự')).toBeInTheDocument();
    expect(resets).toBe(0);
    await user.type(screen.getByLabelText('Mật khẩu mới'), '-nhung-du-dai');
    await user.type(screen.getByLabelText('Nhập lại mật khẩu mới'), 'ngan-nhung-du-dai');
    await user.click(screen.getByRole('button', { name: 'Đặt mật khẩu mới' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mã không đúng hoặc đã hết hạn.');
    expect(resets).toBe(1);
  });
});
