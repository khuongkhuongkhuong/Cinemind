import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import Header from './Header';
import * as auth from '@/hooks/useAuth';

afterEach(() => vi.restoreAllMocks());
const show = (session) => {
  vi.spyOn(auth, 'useAuth').mockReturnValue({ logout: vi.fn(), ...session });
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><Header /></MemoryRouter></QueryClientProvider>);
};

describe('Header — "Vé của tôi" trên thanh menu', () => {
  it('đã đăng nhập: thấy ngay trên thanh menu, không phải mở menu tài khoản', () => {
    show({ status: 'authenticated', user: { fullName: 'An', email: 'an@example.com', role: 'USER', points: 0 } });
    expect(screen.getByRole('link', { name: 'Vé của tôi' })).toHaveAttribute('href', '/me/tickets');
  });

  it('khách chưa đăng nhập: không hiện', () => {
    show({ status: 'anonymous', user: null });
    expect(screen.queryByRole('link', { name: 'Vé của tôi' })).not.toBeInTheDocument();
  });
});
