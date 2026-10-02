import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Pagination, { pageWindow } from './Pagination';

describe('pageWindow', () => {
  it('ít trang: hiện hết, không có dấu …', () => expect(pageWindow(2, 4)).toEqual([1, 2, 3, 4]));
  it('nhiều trang: rút gọn bằng dấu … ở hai đầu', () => {
    expect(pageWindow(10, 20)).toEqual([1, 'gap', 9, 10, 11, 'gap', 20]);
  });
  it('gần đầu / gần cuối', () => {
    expect(pageWindow(1, 20)).toEqual([1, 2, 'gap', 20]);
    expect(pageWindow(20, 20)).toEqual([1, 'gap', 19, 20]);
    expect(pageWindow(3, 20)).toEqual([1, 2, 3, 4, 'gap', 20]);
  });
  it('một trang', () => expect(pageWindow(1, 1)).toEqual([1]));
});

describe('<Pagination />', () => {
  it('chỉ có một trang thì không hiển thị gì', () => {
    const { container } = render(<Pagination page={1} totalPages={1} onChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('đánh dấu trang hiện tại, khóa nút Trước ở trang đầu, và gọi onChange đúng trang', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Pagination page={1} totalPages={5} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Trang 1' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /Trước/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Trang 5' }));
    expect(onChange).toHaveBeenCalledWith(5);
    expect(screen.queryByRole('button', { name: 'Trang 3' })).not.toBeInTheDocument(); // đã rút gọn thành dấu …
    await user.click(screen.getByRole('button', { name: /Sau/ }));
    expect(onChange).toHaveBeenLastCalledWith(2);
  });

  it('khóa nút Sau ở trang cuối', () => {
    render(<Pagination page={5} totalPages={5} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /Sau/ })).toBeDisabled();
  });
});
