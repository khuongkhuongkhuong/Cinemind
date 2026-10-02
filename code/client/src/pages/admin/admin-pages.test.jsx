import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http } from 'msw';
import { setupServer } from 'msw/node';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminMoviesPage from './AdminMoviesPage';
import AdminShowtimesPage from './AdminShowtimesPage';
import AdminPricingPage from './AdminPricingPage';
import AdminOrdersPage from './AdminOrdersPage';
import AdminCinemasPage from './AdminCinemasPage';
import { err, ok, renderPage } from '@/test/helpers';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

const A = '/api/v1';
const meta = { page: 1, pageSize: 10, total: 1, totalPages: 1 };
const movie = { id: 'm1', title: 'Phim thử', slug: 'phim-thu', posterUrl: null, durationMin: 100, ageRating: 'T13', status: 'NOW_SHOWING', releaseDate: '2026-09-01', genres: [{ id: 'g1', name: 'Hành động' }] };
const movieDetail = { ...movie, description: 'Mô tả dài', director: 'Đạo diễn A', actors: null, language: 'Tiếng Việt', trailerUrl: null };
const cinemas = [{ id: 'c1', name: 'Rạp A', address: '1 Đường X', city: { id: 'ct', name: 'Hà Nội' }, rooms: [{ id: 'r1', name: 'Phòng 1', isActive: true, seatCount: 96 }] }];

const common = () => server.use(
  http.get(`${A}/genres`, () => ok([{ id: 'g1', name: 'Hành động' }])),
  http.get(`${A}/admin/cinemas`, () => ok(cinemas)),
);

describe('AdminMoviesPage (A02)', () => {
  it('thêm phim: URL poster không phải http(s) bị chặn ở trình duyệt, KHÔNG gửi request', async () => {
    let posts = 0;
    common();
    server.use(
      http.get(`${A}/admin/movies`, () => ok([movie], meta)),
      http.post(`${A}/admin/movies`, () => { posts += 1; return ok(movie); }),
    );
    const user = userEvent.setup();
    renderPage([{ path: '/', element: <AdminMoviesPage /> }], '/');
    await user.click(await screen.findByRole('button', { name: '+ Thêm phim' }));
    await user.type(screen.getByLabelText('Tên phim'), 'Phim mới');
    await user.type(screen.getByLabelText('Mô tả'), 'abc');
    await user.type(screen.getByLabelText('Thời lượng (phút)'), '90');
    await user.type(screen.getByLabelText('Ngày khởi chiếu'), '2026-12-01');
    await user.type(screen.getByLabelText('URL poster'), 'javascript:alert(1)');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('URL phải bắt đầu bằng http:// hoặc https://')).toBeInTheDocument();
    expect(posts).toBe(0);
  });

  it('thêm phim hợp lệ: gửi đúng body (kèm status, ô trống = null) rồi đóng hộp thoại', async () => {
    let body;
    common();
    server.use(
      http.get(`${A}/admin/movies`, () => ok([movie], meta)),
      http.post(`${A}/admin/movies`, async ({ request }) => { body = await request.json(); return ok(movie); }),
    );
    const user = userEvent.setup();
    renderPage([{ path: '/', element: <AdminMoviesPage /> }], '/');
    await user.click(await screen.findByRole('button', { name: '+ Thêm phim' }));
    await user.type(screen.getByLabelText('Tên phim'), '  Phim mới ');
    await user.type(screen.getByLabelText('Mô tả'), 'abc');
    await user.type(screen.getByLabelText('Thời lượng (phút)'), '90');
    await user.type(screen.getByLabelText('Ngày khởi chiếu'), '2026-12-01');
    await user.click(await screen.findByText('Hành động'));
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({ title: 'Phim mới', durationMin: 90, status: 'COMING_SOON', director: null, posterUrl: null, genreIds: ['g1'] });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('sửa phim: tải bản đầy đủ, KHÔNG gửi status trong PUT', async () => {
    let body;
    common();
    server.use(
      http.get(`${A}/admin/movies`, () => ok([movie], meta)),
      http.get(`${A}/movies/phim-thu`, () => ok(movieDetail)),
      http.put(`${A}/admin/movies/m1`, async ({ request }) => { body = await request.json(); return ok(movieDetail); }),
    );
    const user = userEvent.setup();
    renderPage([{ path: '/', element: <AdminMoviesPage /> }], '/');
    await user.click(await screen.findByRole('button', { name: 'Sửa Phim thử' }));
    expect(await screen.findByDisplayValue('Mô tả dài')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body).not.toHaveProperty('status');
    expect(body.genreIds).toEqual(['g1']);
  });

  it('xóa phim đã có suất (RESOURCE_IN_USE): giải thích và gợi ý "Ngừng chiếu"', async () => {
    common();
    server.use(
      http.get(`${A}/admin/movies`, () => ok([movie], meta)),
      http.delete(`${A}/admin/movies/m1`, () => err(409, 'RESOURCE_IN_USE', 'x')),
    );
    const user = userEvent.setup();
    renderPage([{ path: '/', element: <AdminMoviesPage /> }], '/');
    await user.click(await screen.findByRole('button', { name: 'Xóa Phim thử' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Xóa' }));
    expect(await screen.findByText(/chuyển sang "Ngừng chiếu"/)).toBeInTheDocument();
  });

  it('đổi trạng thái gọi PATCH /status', async () => {
    let body;
    common();
    server.use(
      http.get(`${A}/admin/movies`, () => ok([movie], meta)),
      http.patch(`${A}/admin/movies/m1/status`, async ({ request }) => { body = await request.json(); return ok(movieDetail); }),
    );
    const user = userEvent.setup();
    renderPage([{ path: '/', element: <AdminMoviesPage /> }], '/');
    await user.selectOptions(await screen.findByLabelText('Trạng thái của Phim thử'), 'ENDED');
    await waitFor(() => expect(body).toEqual({ status: 'ENDED' }));
  });
});

describe('AdminShowtimesPage (A03)', () => {
  const showtime = {
    id: 's1', startTime: '2030-10-05T11:30:00.000Z', endTime: '2030-10-05T13:45:00.000Z', format: 'F2D', audio: 'SUBTITLE', basePrice: 80000, status: 'OPEN',
    movie: { id: 'm1', title: 'Phim thử' }, cinema: { id: 'c1', name: 'Rạp A' }, room: { id: 'r1', name: 'Phòng 1' },
  };
  const fill = async (user) => {
    await user.click(await screen.findByRole('button', { name: '+ Thêm suất chiếu' }));
    await user.selectOptions(await screen.findByLabelText('Phim'), 'm1');
    await user.selectOptions(await screen.findByLabelText('Phòng chiếu'), 'r1');
    await user.type(screen.getByLabelText('Giờ chiếu (giờ Việt Nam)'), '2030-10-05T18:30');
  };

  it('⭐ admin nhập 18:30 giờ VN -> gửi 11:30Z; để trống giá thì không gửi basePrice', async () => {
    let body;
    common();
    server.use(
      http.get(`${A}/admin/movies`, () => ok([movie], meta)),
      http.get(`${A}/admin/showtimes`, () => ok([showtime], meta)),
      http.post(`${A}/admin/showtimes`, async ({ request }) => { body = await request.json(); return ok(showtime); }),
    );
    const user = userEvent.setup();
    renderPage([{ path: '/', element: <AdminShowtimesPage /> }], '/');
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body).toEqual({ movieId: 'm1', roomId: 'r1', startTime: '2030-10-05T11:30:00.000Z', format: 'F2D', audio: 'SUBTITLE' });
  });

  it('trùng giờ (SHOWTIME_OVERLAP): hộp thoại vẫn mở, giữ dữ liệu và giải thích', async () => {
    common();
    server.use(
      http.get(`${A}/admin/movies`, () => ok([movie], meta)),
      http.get(`${A}/admin/showtimes`, () => ok([showtime], meta)),
      http.post(`${A}/admin/showtimes`, () => err(409, 'SHOWTIME_OVERLAP', 'x')),
    );
    const user = userEvent.setup();
    renderPage([{ path: '/', element: <AdminShowtimesPage /> }], '/');
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText(/đã có suất khác trùng giờ/)).toBeInTheDocument();
    expect(screen.getByLabelText('Giờ chiếu (giờ Việt Nam)')).toHaveValue('2030-10-05T18:30');
  });

  it('suất đã hủy không có nút Sửa / Hủy', async () => {
    common();
    server.use(http.get(`${A}/admin/showtimes`, () => ok([{ ...showtime, status: 'CANCELLED' }], meta)));
    renderPage([{ path: '/', element: <AdminShowtimesPage /> }], '/');
    expect(await screen.findByText('Đã hủy')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hủy suất' })).not.toBeInTheDocument();
  });
});

describe('AdminPricingPage (A05)', () => {
  const pricing = {
    priceRules: ['F2D', 'F3D', 'IMAX'].flatMap((format) => ['WEEKDAY', 'WEEKEND'].map((dayType) => ({ format, dayType, basePrice: 70000 }))),
    surcharges: [{ seatType: 'STANDARD', surcharge: 0 }, { seatType: 'VIP', surcharge: 20000 }, { seatType: 'COUPLE', surcharge: 30000 }],
  };
  it('hiện đủ 6 giá + 3 phụ thu; sửa một ô rồi lưu gửi đủ bộ (server bắt buộc đủ 9 mục)', async () => {
    let body;
    server.use(
      http.get(`${A}/admin/pricing`, () => ok(pricing)),
      http.put(`${A}/admin/pricing`, async ({ request }) => { body = await request.json(); return ok(pricing); }),
    );
    const user = userEvent.setup();
    renderPage([{ path: '/', element: <AdminPricingPage /> }], '/');
    const vip = await screen.findByLabelText('Ghế VIP');
    await user.clear(vip);
    await user.type(vip, '25000');
    await user.click(screen.getByRole('button', { name: 'Lưu bảng giá' }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body.priceRules).toHaveLength(6);
    expect(body.surcharges.find((s) => s.seatType === 'VIP').surcharge).toBe(25000);
  });
  it('ô giá không hợp lệ -> báo lỗi, không gửi', async () => {
    let puts = 0;
    server.use(
      http.get(`${A}/admin/pricing`, () => ok(pricing)),
      http.put(`${A}/admin/pricing`, () => { puts += 1; return ok(pricing); }),
    );
    const user = userEvent.setup();
    renderPage([{ path: '/', element: <AdminPricingPage /> }], '/');
    await user.clear(await screen.findByLabelText('Ghế VIP'));
    await user.click(screen.getByRole('button', { name: 'Lưu bảng giá' }));
    expect(await screen.findByText('Số nguyên 0–5.000.000')).toBeInTheDocument();
    expect(puts).toBe(0);
  });
});

describe('AdminOrdersPage (A06)', () => {
  const row = (status) => ({
    id: 'o1', code: 'K7Q2M9XA', status, total: 160000, createdAt: '2026-10-01T10:00:00.000Z', paidAt: null, checkedInAt: null,
    user: { id: 'u1', email: 'a@x.vn', fullName: 'Khách A' }, seatLabels: ['G7', 'G8'],
    showtime: { startTime: '2026-10-02T12:45:00.000Z', movieTitle: 'Phim thử', cinemaName: 'Rạp A' },
  });
  const detail = (status) => ({
    id: 'o1', code: 'K7Q2M9XA', status, total: 160000, discount: 0, createdAt: '2026-10-01T10:00:00.000Z', promotion: null,
    showtime: { id: 's1', startTime: '2026-10-02T12:45:00.000Z', movie: { title: 'Phim thử' }, cinema: { name: 'Rạp A' }, room: { name: 'Phòng 1' } },
    seats: [{ label: 'G7', price: 80000 }, { label: 'G8', price: 80000 }], combos: [], user: { fullName: 'Khách A', email: 'a@x.vn', phone: null },
    payments: [{ id: 'p1', txnRef: 'TXN1', amount: 160000, status: 'SUCCESS', bankCode: 'NCB', providerTxnNo: '123' }],
  });
  const open = async (status) => {
    server.use(
      http.get(`${A}/admin/orders`, () => ok([row(status)], meta)),
      http.get(`${A}/admin/orders/o1`, () => ok(detail(status))),
    );
    const user = userEvent.setup();
    renderPage([{ path: '/', element: <AdminOrdersPage /> }], '/');
    await user.click(await screen.findByRole('button', { name: 'Xem đơn K7Q2-M9XA' }));
    return user;
  };

  it('đơn đã thanh toán: xem được giao dịch nhưng KHÔNG có nút hoàn tiền', async () => {
    await open('PAID');
    expect(await screen.findByText(/TXN1/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ghi nhận đã hoàn tiền' })).not.toBeInTheDocument();
  });

  it('⭐ đơn chờ hoàn tiền: phải qua hộp xác nhận mới gọi PATCH /refund', async () => {
    let patches = 0;
    server.use(http.patch(`${A}/admin/orders/o1/refund`, () => { patches += 1; return ok(detail('REFUNDED')); }));
    const user = await open('REFUND_PENDING');
    await user.click(await screen.findByRole('button', { name: 'Ghi nhận đã hoàn tiền' }));
    expect(patches).toBe(0); // mới mở hộp xác nhận
    await user.click(await screen.findByRole('button', { name: 'Đã hoàn tiền' }));
    await waitFor(() => expect(patches).toBe(1));
  });

  it('hai admin cùng bấm: lỗi ORDER_NOT_PENDING được giải thích', async () => {
    server.use(http.patch(`${A}/admin/orders/o1/refund`, () => err(409, 'ORDER_NOT_PENDING', 'x')));
    const user = await open('REFUND_PENDING');
    await user.click(await screen.findByRole('button', { name: 'Ghi nhận đã hoàn tiền' }));
    await user.click(await screen.findByRole('button', { name: 'Đã hoàn tiền' }));
    expect(await screen.findByText(/không còn ở trạng thái chờ hoàn tiền/)).toBeInTheDocument();
  });

  it('bộ lọc trạng thái được gửi lên server', async () => {
    const seen = [];
    server.use(http.get(`${A}/admin/orders`, ({ request }) => { seen.push(new URL(request.url).searchParams.get('status')); return ok([row('PAID')], meta); }));
    const user = userEvent.setup();
    renderPage([{ path: '/', element: <AdminOrdersPage /> }], '/');
    await user.selectOptions(await screen.findByLabelText('Trạng thái'), 'REFUND_PENDING');
    await waitFor(() => expect(seen).toContain('REFUND_PENDING'));
  });
});

describe('AdminCinemasPage (A04)', () => {
  it('chọn phòng -> hiện sơ đồ ghế vật lý, KHÔNG hiện giá', async () => {
    server.use(
      http.get(`${A}/admin/cinemas`, () => ok(cinemas)),
      http.get(`${A}/admin/rooms/r1/seats`, () => ok({
        room: { id: 'r1', name: 'Phòng 1', cinema: { id: 'c1', name: 'Rạp A' } }, rows: ['A'],
        seats: [{ id: 's1', row: 'A', number: 1, label: 'A1', type: 'STANDARD', pairCode: null, isActive: true }, { id: 's2', row: 'A', number: 2, label: 'A2', type: 'VIP', pairCode: null, isActive: false }],
      })),
    );
    const user = userEvent.setup();
    renderPage([{ path: '/', element: <AdminCinemasPage /> }], '/');
    await user.click(await screen.findByRole('button', { name: /Xem sơ đồ Rạp A Phòng 1, 96 ghế/ }));
    expect(await screen.findByRole('button', { name: 'Ghế A1, thường, còn trống' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ghế A2, VIP, không sử dụng được' })).toBeDisabled();
    expect(screen.getByText(/2 ghế: 1 thường · 1 VIP · 0 đôi/)).toBeInTheDocument();
  });
});
