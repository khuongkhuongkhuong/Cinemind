import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import MovieCard from './MovieCard';

const movie = (extra = {}) => ({
  id: 'm1', title: 'Phim thử', slug: 'phim-thu', posterUrl: null, durationMin: 100, ageRating: 'T16', status: 'NOW_SHOWING',
  releaseDate: '2026-11-01', genres: [{ id: 'g1', name: 'Hài' }], trailerUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', ...extra,
});
const show = (extra) => render(<MemoryRouter><MovieCard movie={movie(extra)} /></MemoryRouter>);
const playName = 'Xem trailer phim Phim thử';

describe('MovieCard — lớp phủ trên poster', () => {
  it('phim đang chiếu: có "Xem chi tiết" và "Mua vé" cùng dẫn tới trang phim', () => {
    show();
    expect(screen.getByRole('link', { name: 'Xem chi tiết' })).toHaveAttribute('href', '/movies/phim-thu');
    expect(screen.getByRole('link', { name: 'Mua vé' })).toHaveAttribute('href', '/movies/phim-thu');
  });

  it('phim sắp chiếu: không có "Mua vé"', () => {
    show({ status: 'COMING_SOON' });
    expect(screen.getByRole('link', { name: 'Xem chi tiết' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Mua vé' })).not.toBeInTheDocument();
  });

  it('nút phát mở trailer ngay trên trang (hộp thoại nằm ngoài thẻ phim); đóng thì video bị gỡ', async () => {
    const user = userEvent.setup();
    const { container } = show();
    expect(screen.queryByTitle('Trailer phim Phim thử')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: playName }));
    const frame = screen.getByTitle('Trailer phim Phim thử');
    expect(frame.getAttribute('src')).toContain('/embed/dQw4w9WgXcQ');
    expect(container).not.toContainElement(frame);
    await user.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(screen.queryByTitle('Trailer phim Phim thử')).not.toBeInTheDocument();
  });

  it('không có trailer, hoặc link nguy hiểm: không có nút phát', () => {
    for (const trailerUrl of [null, 'javascript:alert(1)']) {
      const { unmount } = show({ trailerUrl });
      expect(screen.queryByRole('button', { name: playName })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: playName })).not.toBeInTheDocument();
      unmount();
    }
  });
});
