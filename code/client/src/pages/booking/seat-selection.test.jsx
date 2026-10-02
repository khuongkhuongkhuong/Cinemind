import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http } from 'msw';
import { setupServer } from 'msw/node';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SeatSelectionPage from './SeatSelectionPage';
import SeatMap from '@/components/booking/SeatMap';
import { err, ok, renderPage } from '@/test/helpers';
import { render } from '@testing-library/react';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

const seat = (row, number, extra = {}) => ({
  id: `${row}${number}`, row, number, label: `${row}${number}`, type: 'STANDARD', pairCode: null, status: 'AVAILABLE', price: 90_000, ...extra,
});
const baseSeats = () => [
  seat('A', 1), seat('A', 2), seat('A', 3),
  seat('D', 1, { type: 'VIP', price: 105_000 }),
  seat('H', 1, { type: 'COUPLE', pairCode: 'H1-2', price: 200_000 }), seat('H', 2, { type: 'COUPLE', pairCode: 'H1-2', price: 200_000 }),
];
const mapOf = (seats, showtime = {}) => ({
  showtime: {
    id: 'st1', startTime: '2026-10-02T12:45:00.000Z', format: 'F2D', audio: 'SUBTITLE', isOpenForSale: true,
    movie: { id: 'm1', title: 'Phim thử', ageRating: 'T13', posterUrl: null }, cinema: { id: 'c1', name: 'Rạp A' }, room: { id: 'r1', name: 'Phòng 3' }, ...showtime,
  },
  rows: [...new Set(seats.map((s) => s.row))],
  seats,
});

const routes = [
  { path: '/booking/showtimes/:showtimeId', element: <SeatSelectionPage /> },
  { path: '/booking/orders/:orderId', element: <div>TRANG THANH TOÁN</div> },
  { path: '/movies', element: <div>DANH SÁCH PHIM</div> },
];
const ROUTE = '/booking/showtimes/st1';

/** Server giả: `state.seats` có thể đổi giữa các lần tải để mô phỏng người khác giữ ghế. */
function backend(state) {
  const calls = { orders: [] };
  server.use(
    http.get('/api/v1/showtimes/:id/seats', () => ok(mapOf(state.seats, state.showtime))),
    http.post('/api/v1/orders', async ({ request }) => {
      const body = await request.json();
      calls.orders.push(body);
      if (state.orderError) return err(state.orderError.status, state.orderError.code, state.orderError.message, state.orderError.details);
      return ok({ id: 'order-1', status: 'PENDING' });
    }),
  );
  return calls;
}
const seatBtn = (name) => screen.getByRole('button', { name: new RegExp(`^Ghế ${name},`) });

describe('SeatMap', () => {
  const renderMap = (seats, selected = new Set(), onToggle = () => {}) =>
    render(<SeatMap seats={seats} rows={[...new Set(seats.map((s) => s.row))]} selected={selected} onToggle={onToggle} />);

  it('mỗi ghế có tên truy cập đầy đủ: nhãn, loại, giá, trạng thái', () => {
    renderMap(baseSeats());
    expect(seatBtn('A1')).toHaveAccessibleName('Ghế A1, thường, 90.000đ, còn trống');
    expect(seatBtn('D1')).toHaveAccessibleName('Ghế D1, VIP, 105.000đ, còn trống');
  });

  it('⭐ ghế đôi hiển thị thành MỘT nút cho cả cặp, giá là giá cả cặp', () => {
    renderMap(baseSeats());
    const pair = screen.getByRole('button', { name: /^Ghế H1 và H2,/ });
    expect(pair).toHaveAccessibleName('Ghế H1 và H2, đôi, 200.000đ cả cặp, còn trống');
    expect(screen.queryByRole('button', { name: /^Ghế H1,/ })).not.toBeInTheDocument(); // không có nút lẻ
  });

  it('ghế đã bán / đang giữ không bấm được; ghế đang chọn có aria-pressed', () => {
    const seats = baseSeats();
    seats[1].status = 'SOLD';
    seats[2].status = 'HELD';
    renderMap(seats, new Set(['A1']));
    expect(seatBtn('A2')).toBeDisabled();
    expect(seatBtn('A3')).toBeDisabled();
    expect(seatBtn('A1')).toHaveAttribute('aria-pressed', 'true');
    expect(seatBtn('A1')).toHaveAccessibleName(/đang chọn/);
  });

  it('cả cặp đang chọn khi cả hai ghế đều nằm trong lựa chọn', () => {
    renderMap(baseSeats(), new Set(['H1', 'H2']));
    expect(screen.getByRole('button', { name: /^Ghế H1 và H2,/ })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('SeatSelectionPage (P05)', () => {
  it('hiện thông tin suất và sơ đồ ghế; chưa chọn thì nút Tiếp tục bị khóa', async () => {
    backend({ seats: baseSeats() });
    renderPage(routes, ROUTE);
    expect(await screen.findByRole('heading', { name: 'Phim thử' })).toBeInTheDocument();
    expect(screen.getByText(/Rạp A · Phòng 3 · 19:45 T6 02\/10\/2026 · 2D Phụ đề/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tiếp tục/ })).toBeDisabled();
  });

  it('chọn ghế: hiện nhãn, đếm x/8 (ghế đôi tính 2) và tạm tính (cặp chỉ cộng một lần)', async () => {
    backend({ seats: baseSeats() });
    const user = userEvent.setup();
    renderPage(routes, ROUTE);
    await screen.findByRole('heading', { name: 'Phim thử' });
    await user.click(seatBtn('A1'));
    await user.click(screen.getByRole('button', { name: /^Ghế H1 và H2,/ }));
    expect(screen.getByText('Ghế đã chọn (3/8)')).toBeInTheDocument();
    expect(screen.getByText('A1, H1-2')).toBeInTheDocument();
    expect(screen.getByText('290.000đ')).toBeInTheDocument(); // 90.000 + 200.000
    expect(screen.getByRole('button', { name: /Tiếp tục/ })).toBeEnabled();
  });

  it('Tiếp tục: gửi đúng danh sách ghế và chuyển sang trang thanh toán', async () => {
    const calls = backend({ seats: baseSeats() });
    const user = userEvent.setup();
    renderPage(routes, ROUTE);
    await screen.findByRole('heading', { name: 'Phim thử' });
    await user.click(seatBtn('D1'));
    await user.click(seatBtn('A2'));
    await user.click(screen.getByRole('button', { name: /Tiếp tục/ }));
    expect(await screen.findByText('TRANG THANH TOÁN')).toBeInTheDocument();
    expect(calls.orders).toEqual([{ showtimeId: 'st1', seatIds: expect.arrayContaining(['D1', 'A2']) }]);
    expect(calls.orders[0].seatIds).toHaveLength(2);
  });

  it('⭐ SEAT_UNAVAILABLE: báo lỗi, BỎ đúng ghế bị mất, GIỮ ghế còn hợp lệ, và tải lại sơ đồ', async () => {
    const state = { seats: baseSeats(), orderError: { status: 409, code: 'SEAT_UNAVAILABLE', message: 'Ghế D1 vừa có người chọn, vui lòng chọn ghế khác.', details: { seatIds: ['D1'], seatLabels: ['D1'] } } };
    const calls = backend(state);
    const user = userEvent.setup();
    renderPage(routes, ROUTE);
    await screen.findByRole('heading', { name: 'Phim thử' });
    await user.click(seatBtn('D1'));
    await user.click(seatBtn('A2'));

    state.seats = baseSeats().map((s) => (s.id === 'D1' ? { ...s, status: 'HELD' } : s)); // người khác vừa giữ D1
    await user.click(screen.getByRole('button', { name: /Tiếp tục/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Ghế D1 vừa có người chọn');
    await waitFor(() => expect(seatBtn('D1')).toBeDisabled()); // sơ đồ được tải lại: D1 không còn trống
    expect(seatBtn('A2')).toHaveAttribute('aria-pressed', 'true'); // ghế còn hợp lệ được GIỮ NGUYÊN
    expect(screen.getByText('Ghế đã chọn (1/8)')).toBeInTheDocument();
    expect(calls.orders).toHaveLength(1);
    expect(screen.getByTestId('where')).toHaveTextContent(ROUTE); // vẫn ở trang chọn ghế
  });

  it('⭐ sơ đồ tự làm mới: ghế đang chọn bị người khác lấy thì bị bỏ khỏi lựa chọn kèm thông báo (ghế còn lại giữ nguyên)', async () => {
    const state = { seats: baseSeats() };
    backend(state);
    const user = userEvent.setup();
    const { client } = renderPage(routes, ROUTE);
    await screen.findByRole('heading', { name: 'Phim thử' });
    await user.click(seatBtn('A1'));
    await user.click(seatBtn('A2'));
    expect(screen.getByText('Ghế đã chọn (2/8)')).toBeInTheDocument();

    state.seats = baseSeats().map((s) => (s.id === 'A1' ? { ...s, status: 'SOLD' } : s));
    await client.invalidateQueries({ queryKey: ['seatMap'] }); // giống một lần tự làm mới theo chu kỳ

    expect(await screen.findByRole('alert')).toHaveTextContent('Ghế A1 vừa có người khác chọn');
    expect(screen.getByText('Ghế đã chọn (1/8)')).toBeInTheDocument();
    expect(seatBtn('A2')).toHaveAttribute('aria-pressed', 'true');
  });

  it('không chọn được ghế đã bán / quá 8 ghế: báo lỗi bằng thông báo và không đổi lựa chọn', async () => {
    const seats = Array.from({ length: 10 }, (_, i) => seat('B', i + 1));
    seats[0].status = 'SOLD';
    backend({ seats });
    const user = userEvent.setup();
    renderPage(routes, ROUTE);
    await screen.findByRole('heading', { name: 'Phim thử' });
    for (let i = 2; i <= 9; i++) await user.click(seatBtn(`B${i}`)); // 8 ghế
    expect(screen.getByText('Ghế đã chọn (8/8)')).toBeInTheDocument();
    await user.click(seatBtn('B10'));
    expect(await screen.findByRole('alert')).toHaveTextContent('tối đa 8 ghế');
    expect(screen.getByText('Ghế đã chọn (8/8)')).toBeInTheDocument();
  });

  it('SHOWTIME_CLOSED khi bấm Tiếp tục: hộp thoại "Suất chiếu đã đóng bán"', async () => {
    backend({ seats: baseSeats(), orderError: { status: 422, code: 'SHOWTIME_CLOSED', message: 'Suất chiếu đã đóng bán vé.' } });
    const user = userEvent.setup();
    renderPage(routes, ROUTE);
    await screen.findByRole('heading', { name: 'Phim thử' });
    await user.click(seatBtn('A1'));
    await user.click(screen.getByRole('button', { name: /Tiếp tục/ }));
    expect(await screen.findByRole('dialog', { name: 'Suất chiếu đã đóng bán' })).toBeInTheDocument();
  });

  it('suất đã đóng bán ngay từ đầu: có cảnh báo và không chọn / không tiếp tục được', async () => {
    backend({ seats: baseSeats(), showtime: { isOpenForSale: false } });
    renderPage(routes, ROUTE);
    expect(await screen.findByRole('alert')).toHaveTextContent('đã đóng bán');
    expect(seatBtn('A1')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Tiếp tục/ })).toBeDisabled();
  });

  it('suất không tồn tại: trang 404', async () => {
    server.use(http.get('/api/v1/showtimes/:id/seats', () => err(404, 'NOT_FOUND', 'Không tìm thấy suất chiếu.')));
    renderPage(routes, ROUTE);
    expect(await screen.findByText('Không tìm thấy trang')).toBeInTheDocument();
  });

  it('lỗi máy chủ khi tải sơ đồ: trạng thái lỗi có nút thử lại', async () => {
    server.use(http.get('/api/v1/showtimes/:id/seats', () => err(500, 'INTERNAL_ERROR', 'Lỗi')));
    renderPage(routes, ROUTE);
    expect(await screen.findByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
  });
});
