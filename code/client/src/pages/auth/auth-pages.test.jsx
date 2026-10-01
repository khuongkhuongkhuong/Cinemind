import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthContext } from '@/context/AuthContext';
import LoginPage from './LoginPage';
import RegisterPage, { validateRegister } from './RegisterPage';

const serverError = (status, code, message, details) => ({ response: { status, data: { success: false, error: { code, message, details } } } });

function renderLogin({ url = '/login', login = vi.fn(), status = 'anonymous' } = {}) {
  render(
    <AuthContext.Provider value={{ status, user: null, login, register: vi.fn() }}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>TRANG CHỦ</div>} />
          <Route path="/me/tickets" element={<div>VÉ CỦA TÔI</div>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  return { login };
}

async function fillAndSubmit(user, email = 'a@b.co', password = 'mat-khau-123') {
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Mật khẩu'), password);
  await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
}

describe('LoginPage', () => {
  it('đăng nhập thành công: quay lại đúng trang trong returnUrl', async () => {
    const user = userEvent.setup();
    const { login } = renderLogin({ url: '/login?returnUrl=%2Fme%2Ftickets', login: vi.fn().mockResolvedValue({}) });
    await fillAndSubmit(user);
    expect(login).toHaveBeenCalledWith({ email: 'a@b.co', password: 'mat-khau-123' });
    expect(await screen.findByText('VÉ CỦA TÔI')).toBeInTheDocument();
  });

  it('⭐ returnUrl trỏ ra ngoài (open redirect) bị bỏ qua: về trang chủ', async () => {
    const user = userEvent.setup();
    renderLogin({ url: '/login?returnUrl=https%3A%2F%2Ftrang-gia-mao.com', login: vi.fn().mockResolvedValue({}) });
    await fillAndSubmit(user);
    expect(await screen.findByText('TRANG CHỦ')).toBeInTheDocument();
  });

  it('sai mật khẩu (INVALID_CREDENTIALS): hiện lỗi từ server và xóa ô mật khẩu', async () => {
    const user = userEvent.setup();
    renderLogin({ login: vi.fn().mockRejectedValue(serverError(401, 'INVALID_CREDENTIALS', 'Email hoặc mật khẩu không đúng.')) });
    await fillAndSubmit(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('Email hoặc mật khẩu không đúng.');
    expect(screen.getByLabelText('Mật khẩu')).toHaveValue('');
    expect(screen.getByLabelText('Email')).toHaveValue('a@b.co');
  });

  it('bị chặn tốc độ (RATE_LIMITED): hiện lời nhắn thân thiện', async () => {
    const user = userEvent.setup();
    renderLogin({ login: vi.fn().mockRejectedValue(serverError(429, 'RATE_LIMITED', 'raw')) });
    await fillAndSubmit(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(/quá nhiều lần/);
  });

  it('mất mạng: báo lỗi kết nối, không treo nút', async () => {
    const user = userEvent.setup();
    renderLogin({ login: vi.fn().mockRejectedValue(new Error('Network Error')) });
    await fillAndSubmit(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Không kết nối được/);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Đăng nhập' })).toBeEnabled());
  });

  it('thiếu thông tin: báo lỗi từng ô và KHÔNG gọi server', async () => {
    const user = userEvent.setup();
    const { login } = renderLogin();
    await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(screen.getByText('Vui lòng nhập email')).toBeInTheDocument();
    expect(screen.getByText('Vui lòng nhập mật khẩu')).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('đã đăng nhập rồi mà vào /login: chuyển đi, không hiện form', () => {
    renderLogin({ status: 'authenticated' });
    expect(screen.getByText('TRANG CHỦ')).toBeInTheDocument();
  });
});

describe('validateRegister', () => {
  const ok = { fullName: 'An', email: 'an@example.com', phone: '', password: 'mat-khau-123', confirm: 'mat-khau-123' };
  it('hợp lệ -> không có lỗi (số điện thoại có thể bỏ trống)', () => expect(validateRegister(ok)).toEqual({}));
  it('mật khẩu ngắn / không khớp / quá dài', () => {
    expect(validateRegister({ ...ok, password: '1234567', confirm: '1234567' }).password).toMatch(/8 ký tự/);
    expect(validateRegister({ ...ok, confirm: 'khac' }).confirm).toMatch(/không khớp/);
    expect(validateRegister({ ...ok, password: 'x'.repeat(73), confirm: 'x'.repeat(73) }).password).toMatch(/72/);
  });
  it('email và số điện thoại sai định dạng', () => {
    expect(validateRegister({ ...ok, email: 'khong-phai-email' }).email).toBeDefined();
    expect(validateRegister({ ...ok, phone: '12345' }).phone).toBeDefined();
    expect(validateRegister({ ...ok, phone: '0912345678' }).phone).toBeUndefined();
  });
  it('thiếu họ tên', () => expect(validateRegister({ ...ok, fullName: '   ' }).fullName).toBeDefined());
});

describe('RegisterPage', () => {
  it('trùng email (EMAIL_EXISTS): lỗi hiện ngay ở ô email', async () => {
    const user = userEvent.setup();
    const register = vi.fn().mockRejectedValue(serverError(409, 'EMAIL_EXISTS', 'Email này đã được đăng ký.'));
    render(
      <AuthContext.Provider value={{ status: 'anonymous', user: null, register }}>
        <MemoryRouter><RegisterPage /></MemoryRouter>
      </AuthContext.Provider>,
    );
    await user.type(screen.getByLabelText('Họ và tên'), 'An');
    await user.type(screen.getByLabelText('Email'), 'an@example.com');
    await user.type(screen.getByLabelText('Mật khẩu'), 'mat-khau-123');
    await user.type(screen.getByLabelText('Nhập lại mật khẩu'), 'mat-khau-123');
    await user.click(screen.getByRole('button', { name: 'Đăng ký' }));
    expect(await screen.findByText('Email này đã được đăng ký')).toBeInTheDocument();
    expect(register).toHaveBeenCalledWith({ email: 'an@example.com', password: 'mat-khau-123', fullName: 'An' }); // không gửi phone rỗng
  });
});
