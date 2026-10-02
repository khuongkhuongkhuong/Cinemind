import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './AuthContext';
import { useAuth } from '@/hooks/useAuth';
import { getAccessToken, hasSessionHint, setAccessToken, setSessionHint } from '@/api/tokenStore';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
beforeEach(() => { setAccessToken(null); localStorage.clear(); });

const user = { id: '1', email: 'a@b.co', fullName: 'An', phone: null, role: 'USER', points: 0 };
const ok = (data) => HttpResponse.json({ success: true, data });

function Probe() {
  const { status, user: u, login, logout } = useAuth();
  return (
    <div>
      <div data-testid="status">{status}</div>
      <div data-testid="name">{u?.fullName ?? '-'}</div>
      <button onClick={() => login({ email: 'a@b.co', password: 'x' })}>login</button>
      <button onClick={logout}>logout</button>
    </div>
  );
}
const mount = () => render(
  <QueryClientProvider client={new QueryClient()}><AuthProvider><Probe /></AuthProvider></QueryClientProvider>,
);

describe('AuthProvider', () => {
  it('⭐ chưa từng đăng nhập: KHÔNG gọi /auth/refresh (không gây lỗi 401 đỏ trong console) và về trạng thái anonymous', async () => {
    let refreshCalls = 0;
    server.use(http.post('/api/v1/auth/refresh', () => { refreshCalls++; return ok({ accessToken: 't' }); }));
    mount();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));
    expect(refreshCalls).toBe(0);
  });

  it('có dấu hiệu từng đăng nhập: khôi phục phiên bằng cookie (refresh rồi /me)', async () => {
    setSessionHint(true);
    server.use(
      http.post('/api/v1/auth/refresh', () => ok({ accessToken: 'tok-1' })),
      http.get('/api/v1/auth/me', ({ request }) => (request.headers.get('authorization') === 'Bearer tok-1' ? ok(user) : new HttpResponse(null, { status: 401 }))),
    );
    mount();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(screen.getByTestId('name')).toHaveTextContent('An');
    expect(getAccessToken()).toBe('tok-1');
  });

  it('cookie đã hết hạn: về anonymous và xóa dấu hiệu để lần mở trang sau khỏi thử lại', async () => {
    setSessionHint(true);
    server.use(http.post('/api/v1/auth/refresh', () => HttpResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'x' } }, { status: 401 })));
    mount();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));
    expect(hasSessionHint()).toBe(false);
  });

  it('đăng nhập đặt dấu hiệu + token trong bộ nhớ; đăng xuất xóa cả hai (kể cả khi server báo lỗi)', async () => {
    const u = userEvent.setup();
    server.use(
      http.post('/api/v1/auth/login', () => ok({ user, accessToken: 'tok-2' })),
      http.post('/api/v1/auth/logout', () => HttpResponse.json({ success: false, error: { code: 'TOKEN_EXPIRED', message: 'x' } }, { status: 500 })),
    );
    mount();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));

    await u.click(screen.getByText('login'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(getAccessToken()).toBe('tok-2');
    expect(hasSessionHint()).toBe(true);

    await u.click(screen.getByText('logout'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));
    expect(getAccessToken()).toBeNull();
    expect(hasSessionHint()).toBe(false);
  });

  it('⭐ access token không bao giờ được ghi vào localStorage / sessionStorage', async () => {
    const u = userEvent.setup();
    server.use(http.post('/api/v1/auth/login', () => ok({ user, accessToken: 'tok-bi-mat-xyz' })));
    mount();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));
    await u.click(screen.getByText('login'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    const dump = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(dump).not.toContain('tok-bi-mat-xyz');
  });
});
