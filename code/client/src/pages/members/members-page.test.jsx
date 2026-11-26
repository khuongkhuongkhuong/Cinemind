import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import MembersPage from './MembersPage';
import * as auth from '@/hooks/useAuth';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => { server.resetHandlers(); vi.restoreAllMocks(); });

const show = (session) => {
  vi.spyOn(auth, 'useAuth').mockReturnValue(session);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><MembersPage /></MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('MembersPage (P14)', () => {
  it('khách: mời đăng ký / đăng nhập (đăng nhập xong quay lại trang này), không gọi API hồ sơ', () => {
    show({ status: 'anonymous', user: null }); // onUnhandledRequest: 'error' sẽ báo nếu có gọi /auth/me
    expect(screen.getByRole('link', { name: 'Đăng ký thành viên' })).toHaveAttribute('href', '/register');
    expect(screen.getByRole('link', { name: 'Tôi đã có tài khoản' }).getAttribute('href')).toContain('returnUrl=%2Fmembers');
    expect(screen.queryByTestId('points')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cách tích điểm' })).toBeInTheDocument();
  });

  it('⭐ thành viên: điểm lấy MỚI từ server, không dùng số cũ lúc đăng nhập', async () => {
    server.use(http.get('/api/v1/auth/me', () => HttpResponse.json({ success: true, data: { fullName: 'An', points: 57 } })));
    show({ status: 'authenticated', user: { fullName: 'An', points: 20 } });
    await waitFor(() => expect(screen.getByTestId('points')).toHaveTextContent('57'));
    expect(screen.getByRole('link', { name: 'Vé của tôi' })).toHaveAttribute('href', '/me/tickets');
    expect(screen.queryByRole('link', { name: 'Đăng ký thành viên' })).not.toBeInTheDocument();
  });
});
