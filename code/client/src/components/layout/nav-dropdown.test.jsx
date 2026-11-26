import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import NavDropdown from './NavDropdown';

function Where() { return <div data-testid="where">{useLocation().pathname}</div>; }
const show = () => render(
  <MemoryRouter>
    <NavDropdown to="/members" label="Thành viên" useItems={() => [{ to: '/me/profile', label: 'Tài khoản Cinemind' }, { to: '/members', label: 'Quyền lợi' }]} />
    <button type="button">ngoài menu</button>
    <Where />
  </MemoryRouter>,
);
const sub = () => screen.queryByRole('link', { name: 'Tài khoản Cinemind' });

describe('NavDropdown', () => {
  it('ẩn menu con; rê chuột vào thì hiện, rời chuột thì ẩn', async () => {
    const user = userEvent.setup();
    show();
    expect(sub()).not.toBeInTheDocument();
    await user.hover(screen.getByRole('link', { name: 'Thành viên' }));
    expect(sub()).toHaveAttribute('href', '/me/profile');
    expect(screen.getByRole('link', { name: 'Quyền lợi' })).toHaveAttribute('href', '/members');
    await user.unhover(screen.getByRole('link', { name: 'Thành viên' }));
    expect(sub()).not.toBeInTheDocument();
  });

  it('dùng bàn phím: Tab tới thì mở, Tab tiếp đi vào menu con, Esc đóng', async () => {
    const user = userEvent.setup();
    show();
    await user.tab();
    expect(sub()).toBeInTheDocument();
    await user.tab();
    expect(sub()).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(sub()).not.toBeInTheDocument();
  });

  it('đưa tiêu điểm ra ngoài thì đóng; chọn một mục thì chuyển trang và đóng', async () => {
    const user = userEvent.setup();
    show();
    await user.tab(); await user.tab(); await user.tab(); await user.tab(); // qua hết menu, tới nút ngoài
    expect(screen.getByRole('button', { name: 'ngoài menu' })).toHaveFocus();
    expect(sub()).not.toBeInTheDocument();
    await user.hover(screen.getByRole('link', { name: 'Thành viên' }));
    // user-event không gửi relatedTarget khi di chuột nên tưởng là rời menu; bấm trực tiếp (rê chuột thật đã kiểm trên trình duyệt).
    fireEvent.click(sub());
    expect(screen.getByTestId('where')).toHaveTextContent('/me/profile');
    expect(sub()).not.toBeInTheDocument();
  });
});
