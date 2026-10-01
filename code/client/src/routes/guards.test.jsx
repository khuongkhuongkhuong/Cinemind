import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AuthContext } from '@/context/AuthContext';
import RequireAuth from './RequireAuth';
import RequireRole from './RequireRole';

const user = (role) => ({ id: '1', email: 'a@b.co', fullName: 'A', role, points: 0 });

function Where() {
  const loc = useLocation();
  return <div>ĐANG Ở {loc.pathname}{loc.search}</div>;
}

function renderAt(path, auth) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<Where />} />
          <Route path="/403" element={<div>KHÔNG CÓ QUYỀN</div>} />
          <Route element={<RequireAuth />}>
            <Route path="/me/tickets" element={<div>VÉ CỦA TÔI</div>} />
            <Route element={<RequireRole roles={['STAFF', 'ADMIN']} />}>
              <Route path="/staff/check-in" element={<div>SOÁT VÉ</div>} />
            </Route>
            <Route element={<RequireRole roles={['ADMIN']} />}>
              <Route path="/admin" element={<div>QUẢN TRỊ</div>} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('RequireAuth', () => {
  it('chưa đăng nhập: chuyển tới /login kèm returnUrl là trang đang xem', () => {
    renderAt('/me/tickets?tab=paid', { status: 'anonymous', user: null });
    expect(screen.getByText(/ĐANG Ở \/login\?returnUrl=%2Fme%2Ftickets%3Ftab%3Dpaid/)).toBeInTheDocument();
  });

  it('đang khôi phục phiên: chờ (không vội đẩy ra trang đăng nhập)', () => {
    renderAt('/me/tickets', { status: 'loading', user: null });
    expect(screen.getByRole('status', { name: /đang kiểm tra đăng nhập/i })).toBeInTheDocument();
    expect(screen.queryByText(/ĐANG Ở/)).not.toBeInTheDocument();
  });

  it('đã đăng nhập: vào được', () => {
    renderAt('/me/tickets', { status: 'authenticated', user: user('USER') });
    expect(screen.getByText('VÉ CỦA TÔI')).toBeInTheDocument();
  });
});

describe('RequireRole', () => {
  it('USER vào trang nhân viên / quản trị: về /403', () => {
    renderAt('/staff/check-in', { status: 'authenticated', user: user('USER') });
    expect(screen.getByText('KHÔNG CÓ QUYỀN')).toBeInTheDocument();
  });

  it('STAFF vào được trang soát vé nhưng không vào được trang quản trị', () => {
    const { unmount } = renderAt('/staff/check-in', { status: 'authenticated', user: user('STAFF') });
    expect(screen.getByText('SOÁT VÉ')).toBeInTheDocument();
    unmount();
    renderAt('/admin', { status: 'authenticated', user: user('STAFF') });
    expect(screen.getByText('KHÔNG CÓ QUYỀN')).toBeInTheDocument();
  });

  it('ADMIN vào được cả hai (ADMIN được coi là STAFF)', () => {
    const { unmount } = renderAt('/staff/check-in', { status: 'authenticated', user: user('ADMIN') });
    expect(screen.getByText('SOÁT VÉ')).toBeInTheDocument();
    unmount();
    renderAt('/admin', { status: 'authenticated', user: user('ADMIN') });
    expect(screen.getByText('QUẢN TRỊ')).toBeInTheDocument();
  });
});
