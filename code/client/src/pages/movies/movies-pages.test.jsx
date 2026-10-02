import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import MoviesPage from './MoviesPage';
import MovieDetailPage from './MovieDetailPage';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
beforeEach(() => localStorage.clear());

const ok = (data, meta) => HttpResponse.json({ success: true, data, ...(meta && { meta }) });
const err = (status, code, message) => HttpResponse.json({ success: false, error: { code, message } }, { status });
const movie = (n, extra = {}) => ({
  id: `m${n}`, title: `Phim số ${n}`, slug: `phim-so-${n}`, posterUrl: null, durationMin: 100, ageRating: 'T13',
  status: 'NOW_SHOWING', releaseDate: '2026-09-12', genres: [{ id: 'g1', name: 'Hài' }], ...extra,
});

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname}{l.search}</div>; }
const wrap = (ui, path) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[path]}>{ui}<Where /></MemoryRouter>
  </QueryClientProvider>,
);
const listRoutes = <Routes><Route path="/movies" element={<MoviesPage />} /></Routes>;

/** Server giả cho trang danh sách; ghi lại mọi truy vấn /movies để kiểm tra tham số gửi đi. */
function moviesBackend({ items = [movie(1), movie(2)], meta, fail } = {}) {
  const requests = [];
  server.use(
    http.get('/api/v1/genres', () => ok([{ id: 'g1', name: 'Hài' }, { id: 'g2', name: 'Kinh dị' }])),
    http.get('/api/v1/movies', ({ request }) => {
      const url = new URL(request.url);
      requests.push(Object.fromEntries(url.searchParams));
      if (fail) return err(500, 'INTERNAL_ERROR', 'Lỗi máy chủ');
      return ok(items, meta ?? { page: Number(url.searchParams.get('page') ?? 1), pageSize: 10, total: items.length, totalPages: 1 });
    }),
  );
  return requests;
}

describe('MoviesPage (P02)', () => {
  it('hiện danh sách phim và tổng số; mặc định lọc "đang chiếu"', async () => {
    const requests = moviesBackend();
    wrap(listRoutes, '/movies');
    expect(await screen.findByText('Phim số 1')).toBeInTheDocument();
    expect(screen.getByText('2 phim')).toBeInTheDocument();
    expect(requests[0]).toMatchObject({ status: 'NOW_SHOWING', page: '1', pageSize: '10' });
  });

  it('tab "Sắp chiếu" gửi COMING_SOON và ghi lên URL', async () => {
    const requests = moviesBackend();
    const user = userEvent.setup();
    wrap(listRoutes, '/movies');
    await screen.findByText('Phim số 1');
    await user.click(screen.getByRole('tab', { name: 'Sắp chiếu' }));
    await waitFor(() => expect(requests.at(-1).status).toBe('COMING_SOON'));
    expect(screen.getByTestId('where')).toHaveTextContent('status=soon');
  });

  it('⭐ tìm kiếm chỉ gọi API sau khi ngừng gõ (debounce), không gọi ở mỗi phím', async () => {
    const requests = moviesBackend();
    const user = userEvent.setup();
    wrap(listRoutes, '/movies');
    await screen.findByText('Phim số 1');
    const before = requests.length;
    await user.type(screen.getByLabelText('Tìm phim theo tên'), 'nha ba');
    expect(requests.length).toBe(before); // gõ xong 6 ký tự nhưng chưa gọi thêm lần nào
    await waitFor(() => expect(requests.at(-1).q).toBe('nha ba'), { timeout: 2000 });
    expect(requests.length).toBe(before + 1); // đúng một lần
    expect(screen.getByTestId('where')).toHaveTextContent('q=nha+ba');
  });

  it('bộ lọc đọc từ URL: q, genre, page; đổi bộ lọc thì về trang 1', async () => {
    const requests = moviesBackend({ meta: { page: 3, pageSize: 10, total: 50, totalPages: 5 } });
    const user = userEvent.setup();
    wrap(listRoutes, '/movies?q=bong&genre=g2&page=3');
    await screen.findByText('Phim số 1');
    expect(requests[0]).toMatchObject({ q: 'bong', genreId: 'g2', page: '3' });
    expect(screen.getByLabelText('Tìm phim theo tên')).toHaveValue('bong');
    await user.selectOptions(screen.getByLabelText('Thể loại'), 'g1');
    await waitFor(() => expect(requests.at(-1)).toMatchObject({ genreId: 'g1', page: '1' }));
  });

  it('phân trang: bấm trang 2 gửi page=2', async () => {
    const requests = moviesBackend({ meta: { page: 1, pageSize: 10, total: 25, totalPages: 3 } });
    const user = userEvent.setup();
    wrap(listRoutes, '/movies');
    await screen.findByText('Phim số 1');
    await user.click(screen.getByRole('button', { name: 'Trang 2' }));
    await waitFor(() => expect(requests.at(-1).page).toBe('2'));
  });

  it('không có kết quả khi đang lọc: báo rõ và có nút xóa bộ lọc đưa về trạng thái ban đầu', async () => {
    moviesBackend({ items: [] });
    const user = userEvent.setup();
    wrap(listRoutes, '/movies?q=khong-co');
    expect(await screen.findByText('Không tìm thấy phim phù hợp')).toBeInTheDocument();
    await user.click(within(screen.getByText('Không tìm thấy phim phù hợp').parentElement).getByRole('button', { name: 'Xóa bộ lọc' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/movies?status=now'));
    expect(screen.getByLabelText('Tìm phim theo tên')).toHaveValue('');
  });

  it('lỗi máy chủ: hiện trạng thái lỗi có nút thử lại', async () => {
    moviesBackend({ fail: true });
    wrap(listRoutes, '/movies');
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được dữ liệu');
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
  });

  it('status lạ trên URL không bị đẩy nguyên lên API', async () => {
    const requests = moviesBackend();
    wrap(listRoutes, '/movies?status=ENDED');
    await screen.findByText('Phim số 1');
    expect(requests[0].status).toBe('NOW_SHOWING');
  });
});

// ------------------------------------------------------------------ CHI TIẾT PHIM
const detailRoutes = <Routes><Route path="/movies/:slug" element={<MovieDetailPage />} /></Routes>;
const detail = (extra = {}) => ({ ...movie(1), description: 'Mô tả phim thử', director: 'Đạo diễn A', actors: 'A, B', language: 'Tiếng Việt', trailerUrl: null, ...extra });

function detailBackend(movieData, schedule) {
  server.use(
    http.get('/api/v1/movies/:slug', () => (movieData ? ok(movieData) : err(404, 'NOT_FOUND', 'Không tìm thấy phim.'))),
    http.get('/api/v1/cities', () => ok([{ id: 'ha', name: 'Hà Nội' }, { id: 'hcm', name: 'Hồ Chí Minh' }])),
    http.get('/api/v1/movies/:movieId/showtimes', ({ request }) => {
      const q = new URL(request.url).searchParams;
      detailBackend.last = { date: q.get('date'), cityId: q.get('cityId') };
      return ok(schedule ?? { date: q.get('date'), cinemas: [] });
    }),
  );
}
const SCHEDULE = {
  date: 'x',
  cinemas: [{
    cinema: { id: 'cn1', name: 'Cinemind Cầu Giấy', address: '102 Cầu Giấy' },
    groups: [
      { format: 'F2D', audio: 'SUBTITLE', showtimes: [
        { id: 'st-closed', startTime: '2026-10-02T02:30:00.000Z', isOpenForSale: false },
        { id: 'st-open', startTime: '2026-10-02T12:45:00.000Z', isOpenForSale: true },
      ] },
    ],
  }],
};

describe('MovieDetailPage (P03)', () => {
  it('phim không tồn tại (NOT_FOUND): hiện trang 404', async () => {
    detailBackend(null);
    wrap(detailRoutes, '/movies/khong-co');
    expect(await screen.findByText('Không tìm thấy trang')).toBeInTheDocument();
  });

  it('hiện thông tin phim, cảnh báo độ tuổi T16, và link trailer http(s)', async () => {
    detailBackend(detail({ ageRating: 'T16', trailerUrl: 'https://youtube.com/watch?v=1' }), SCHEDULE);
    wrap(detailRoutes, '/movies/phim-so-1');
    expect(await screen.findByRole('heading', { name: 'Phim số 1' })).toBeInTheDocument();
    expect(screen.getByText('Mô tả phim thử')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('từ 16 tuổi');
    const trailer = screen.getByRole('link', { name: /Xem trailer/ });
    expect(trailer).toHaveAttribute('href', 'https://youtube.com/watch?v=1');
    expect(trailer).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('⭐ trailer có scheme nguy hiểm (javascript:) KHÔNG được hiển thị thành link', async () => {
    detailBackend(detail({ trailerUrl: 'javascript:alert(1)' }), SCHEDULE);
    wrap(detailRoutes, '/movies/phim-so-1');
    await screen.findByRole('heading', { name: 'Phim số 1' });
    expect(screen.queryByRole('link', { name: /Xem trailer/ })).not.toBeInTheDocument();
  });

  it('lịch chiếu: suất còn mở là liên kết tới trang chọn ghế; suất đã đóng bán KHÔNG bấm được', async () => {
    detailBackend(detail(), SCHEDULE);
    wrap(detailRoutes, '/movies/phim-so-1');
    expect(await screen.findByText('Cinemind Cầu Giấy')).toBeInTheDocument();
    expect(screen.getByText('2D Phụ đề')).toBeInTheDocument();
    const open = screen.getByRole('link', { name: 'Chọn suất 19:45' }); // 12:45 UTC = 19:45 giờ VN
    expect(open).toHaveAttribute('href', '/booking/showtimes/st-open');
    expect(screen.getByLabelText('09:30, đã đóng bán')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /09:30/ })).not.toBeInTheDocument();
  });

  it('chọn thành phố mặc định là thành phố đầu tiên, nhớ lựa chọn lần sau, và đổi ngày thì gọi lại với ngày mới', async () => {
    detailBackend(detail(), SCHEDULE);
    const user = userEvent.setup();
    wrap(detailRoutes, '/movies/phim-so-1');
    await screen.findByText('Cinemind Cầu Giấy');
    expect(detailBackend.last.cityId).toBe('ha');

    await user.selectOptions(screen.getByLabelText('Thành phố'), 'hcm');
    await waitFor(() => expect(detailBackend.last.cityId).toBe('hcm'));
    expect(localStorage.getItem('cinemind:city')).toBe('hcm');

    const firstDate = detailBackend.last.date;
    await user.click(screen.getAllByRole('tab')[1]); // ngày thứ hai
    await waitFor(() => expect(detailBackend.last.date).not.toBe(firstDate));
  });

  it('ngày không có suất: hiện trạng thái rỗng', async () => {
    detailBackend(detail(), { date: 'x', cinemas: [] });
    wrap(detailRoutes, '/movies/phim-so-1');
    expect(await screen.findByText('Chưa có suất chiếu')).toBeInTheDocument();
  });

  it('mọi suất của ngày đã đóng bán: có lời nhắc chọn ngày khác', async () => {
    const closed = { ...SCHEDULE, cinemas: [{ ...SCHEDULE.cinemas[0], groups: [{ format: 'F2D', audio: 'SUBTITLE', showtimes: [{ id: 'z', startTime: '2026-10-02T02:30:00.000Z', isOpenForSale: false }] }] }] };
    detailBackend(detail(), closed);
    wrap(detailRoutes, '/movies/phim-so-1');
    expect(await screen.findByText(/đã đóng bán\. Hãy chọn ngày khác/)).toBeInTheDocument();
  });

  it('phim sắp chiếu: không có bộ chọn suất, có thông báo ngày khởi chiếu', async () => {
    detailBackend(detail({ status: 'COMING_SOON', releaseDate: '2026-11-10' }));
    wrap(detailRoutes, '/movies/phim-so-1');
    expect(await screen.findByText(/Phim khởi chiếu từ 10\/11\/2026/)).toBeInTheDocument();
    expect(screen.queryByText('Lịch chiếu')).not.toBeInTheDocument();
  });

  it('phim đã ngừng chiếu: báo rõ, không có bộ chọn suất', async () => {
    detailBackend(detail({ status: 'ENDED' }));
    wrap(detailRoutes, '/movies/phim-so-1');
    expect(await screen.findByText('Phim đã ngừng chiếu.')).toBeInTheDocument();
    expect(screen.queryByText('Lịch chiếu')).not.toBeInTheDocument();
  });
});
