import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { http } from 'msw';
import { setupServer } from 'msw/node';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CheckoutPage from './CheckoutPage';
import { err, ok, renderPage } from '@/test/helpers';
import { goToGateway, paymentSimulatorEnabled } from '@/lib/navigation';
import { noteServerDate, resetClock } from '@/lib/clock';

vi.mock('@/lib/navigation', () => ({ goToGateway: vi.fn(() => true), paymentSimulatorEnabled: vi.fn(() => false) }));

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => { server.resetHandlers(); vi.clearAllMocks(); });
beforeEach(() => { resetClock(); vi.mocked(goToGateway).mockReturnValue(true); vi.mocked(paymentSimulatorEnabled).mockReturnValue(false); });

const COMBOS = [
  { id: 'c1', name: 'Combo Solo', description: '1 bắp + 1 nước', price: 69_000, imageUrl: null },
  { id: 'c2', name: 'Combo Đôi', description: null, price: 99_000, imageUrl: null },
];
const makeOrder = (extra = {}) => ({
  id: 'o1', code: 'K7Q2M9XA', status: 'PENDING', expiresAt: new Date(Date.now() + 9 * 60_000 + 30_000).toISOString(),
  showtime: { id: 'st1', startTime: '2026-10-02T12:45:00.000Z', format: 'F2D', audio: 'SUBTITLE', movie: { title: 'Phim thử', ageRating: 'T13', posterUrl: null }, cinema: { name: 'Rạp A' }, room: { name: 'Phòng 3' } },
  seats: [{ seatId: 'A1', label: 'A1', type: 'STANDARD', price: 90_000 }, { seatId: 'D1', label: 'D1', type: 'VIP', price: 105_000 }],
  combos: [], promotion: null, seatTotal: 195_000, comboTotal: 0, discount: 0, total: 195_000, paidAt: null, checkedInAt: null, ...extra,
});

const routes = [
  { path: '/booking/orders/:orderId', element: <CheckoutPage /> },
  { path: '/booking/showtimes/:id', element: <div>TRANG CHỌN GHẾ</div> },
  { path: '/me/tickets/:code', element: <div>TRANG VÉ</div> },
  { path: '/payment/result', element: <div>TRANG KẾT QUẢ</div> },
];
const ROUTE = '/booking/orders/o1';

/** Server giả có trạng thái. `state.order` là đơn hiện tại; mỗi handler ghi lại lời gọi để kiểm tra. */
function backend(state) {
  const calls = { combos: [], promo: [], payments: 0, cancels: 0, simulate: [] };
  server.use(
    http.get('/api/v1/orders/:id', () => (state.getError ? err(state.getError.status, state.getError.code, 'x') : ok(state.order))),
    http.get('/api/v1/combos', () => ok(COMBOS)),
    http.put('/api/v1/orders/:id/combos', async ({ request }) => {
      const { items } = await request.json();
      calls.combos.push(items);
      if (state.comboError) return err(state.comboError.status, state.comboError.code, 'Đơn hàng đã quá hạn giữ ghế.');
      state.order = state.nextOrder?.(items) ?? { ...state.order, combos: items.map((i) => ({ comboId: i.comboId, name: COMBOS.find((c) => c.id === i.comboId).name, quantity: i.quantity, unitPrice: 1, subtotal: 1 })) };
      return ok(state.order);
    }),
    http.post('/api/v1/orders/:id/promotion', async ({ request }) => {
      const { code } = await request.json();
      calls.promo.push(code);
      if (state.promoError) return err(422, 'PROMO_INVALID', 'Mã không dùng được.', { reason: state.promoError });
      state.order = { ...state.order, promotion: { code, name: 'Giảm', discount: 30_000 }, discount: 30_000, total: state.order.total - 30_000 };
      return ok(state.order);
    }),
    http.delete('/api/v1/orders/:id/promotion', () => { state.order = { ...state.order, promotion: null, discount: 0, total: state.order.seatTotal }; return ok(state.order); }),
    http.post('/api/v1/orders/:id/cancel', () => { calls.cancels++; return ok({ ...state.order, status: 'CANCELLED' }); }),
    http.post('/api/v1/orders/:id/payments', () => {
      calls.payments++;
      if (state.payError) return err(state.payError.status, state.payError.code, 'Đơn hàng đã quá hạn giữ ghế.');
      return ok({ paymentId: 'p1', txnRef: 'K7Q2M9XA-1', paymentUrl: state.paymentUrl ?? 'https://sandbox.vnpayment.vn/pay?x=1', expiresAt: state.order.expiresAt }, undefined);
    }),
    http.post('/api/v1/dev/payments/:txnRef/simulate', ({ params }) => { calls.simulate.push(params.txnRef); return new Response(JSON.stringify({ RspCode: '00', Message: 'Confirm Success' }), { headers: { 'Content-Type': 'application/json' } }); }),
  );
  return calls;
}
const payBtn = () => screen.getByRole('button', { name: /Thanh toán/ });
const total = () => screen.getByTestId('order-total');

describe('CheckoutPage (P06)', () => {
  it('hiện tóm tắt đơn từ server và đồng hồ đếm ngược theo hạn giữ ghế', async () => {
    backend({ order: makeOrder() });
    renderPage(routes, ROUTE);
    expect(await screen.findByText('Phim thử')).toBeInTheDocument();
    expect(screen.getByText(/Rạp A · Phòng 3/)).toBeInTheDocument();
    expect(screen.getByText('Ghế A1')).toBeInTheDocument();
    expect(total()).toHaveTextContent('195.000đ');
    expect(screen.getByTestId('countdown').textContent).toMatch(/^0[89]:\d\d$/); // ~09:30 còn lại
    expect(screen.getByRole('timer')).toBeInTheDocument();
  });

  it('⭐ đếm ngược dùng ĐỒNG HỒ SERVER: máy người dùng chạy nhanh 5 phút vẫn hiển thị đúng thời gian còn lại', async () => {
    const serverNow = Date.now();
    // Server báo giờ chậm hơn máy khách 5 phút (header Date); hạn giữ ghế tính theo giờ server: còn 9 phút.
    noteServerDate(new Date(serverNow - 5 * 60_000).toUTCString());
    backend({ order: makeOrder({ expiresAt: new Date(serverNow - 5 * 60_000 + 9 * 60_000).toISOString() }) });
    renderPage(routes, ROUTE);
    await screen.findByText('Phim thử');
    expect(screen.getByTestId('countdown').textContent).toMatch(/^0[89]:\d\d$/); // KHÔNG phải 04:00 (nếu dùng đồng hồ máy)
    expect(screen.queryByRole('dialog', { name: 'Đã hết thời gian giữ ghế' })).not.toBeInTheDocument();
  });

  it('⭐ chọn combo: sau khi ngừng bấm mới gửi MỘT lần cả danh sách; tổng tiền hiển thị là con số của SERVER', async () => {
    const state = { order: makeOrder(), nextOrder: (items) => makeOrder({ combos: items.map((i) => ({ comboId: i.comboId, name: 'Combo Solo', quantity: i.quantity, unitPrice: 69_000, subtotal: 69_000 * i.quantity })), comboTotal: 138_000, total: 123_456 }) };
    const calls = backend(state);
    const user = userEvent.setup();
    renderPage(routes, ROUTE);
    await screen.findByText('Phim thử');
    await user.click(screen.getByRole('button', { name: 'Tăng Combo Solo' }));
    await user.click(screen.getByRole('button', { name: 'Tăng Combo Solo' }));
    expect(calls.combos).toHaveLength(0); // chưa gửi: người dùng còn đang bấm
    await waitFor(() => expect(calls.combos).toHaveLength(1), { timeout: 2000 });
    expect(calls.combos[0]).toEqual([{ comboId: 'c1', quantity: 2 }]);
    await waitFor(() => expect(total()).toHaveTextContent('123.456đ')); // số lạ của server; client không tự cộng 195.000 + 138.000
  });

  it('⭐ nút Thanh toán bị khóa khi combo chưa đồng bộ với server (link thanh toán gắn với tổng tiền lúc tạo)', async () => {
    backend({ order: makeOrder() });
    const user = userEvent.setup();
    renderPage(routes, ROUTE);
    await screen.findByText('Phim thử');
    expect(payBtn()).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Tăng Combo Đôi' }));
    expect(payBtn()).toBeDisabled(); // đã thay đổi nhưng chưa gửi / chưa nhận lại tổng mới
    await waitFor(() => expect(payBtn()).toBeEnabled(), { timeout: 2500 });
  });

  it('số lượng combo trong khoảng 0–10', async () => {
    backend({ order: makeOrder() });
    const user = userEvent.setup();
    renderPage(routes, ROUTE);
    await screen.findByText('Phim thử');
    expect(screen.getByRole('button', { name: 'Giảm Combo Solo' })).toBeDisabled();
    const plus = screen.getByRole('button', { name: 'Tăng Combo Solo' });
    for (let i = 0; i < 12; i++) await user.click(plus);
    expect(screen.getByRole('group', { name: 'Số lượng Combo Solo' })).toHaveTextContent('10');
    expect(plus).toBeDisabled();
  });

  it.each([
    ['NOT_FOUND', 'Mã không tồn tại hoặc đã bị tắt.'],
    ['NOT_STARTED', 'Mã chưa đến thời gian áp dụng.'],
    ['EXPIRED', 'Mã đã hết hạn.'],
    ['USAGE_LIMIT_REACHED', 'Mã đã hết lượt sử dụng.'],
    ['MIN_ORDER_NOT_MET', 'Đơn hàng chưa đạt giá trị tối thiểu để dùng mã này.'],
    ['ALREADY_USED', 'Bạn đã dùng mã này rồi.'],
  ])('mã bị từ chối với lý do %s: hiện thông báo tiếng Việt đúng lý do', async (reason, message) => {
    backend({ order: makeOrder(), promoError: reason });
    const user = userEvent.setup();
    renderPage(routes, ROUTE);
    await screen.findByText('Phim thử');
    await user.type(screen.getByLabelText('Mã khuyến mãi'), 'abc');
    await user.click(screen.getByRole('button', { name: 'Áp dụng' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(total()).toHaveTextContent('195.000đ'); // đơn không đổi
  });

  it('áp mã thành công (mã được đổi thành chữ hoa): hiện giảm giá từ server; gỡ mã thì về tổng cũ', async () => {
    const calls = backend({ order: makeOrder() });
    const user = userEvent.setup();
    renderPage(routes, ROUTE);
    await screen.findByText('Phim thử');
    await user.type(screen.getByLabelText('Mã khuyến mãi'), 'cine10');
    await user.click(screen.getByRole('button', { name: 'Áp dụng' }));
    expect(await screen.findByText(/Đã áp dụng/)).toHaveTextContent('CINE10');
    expect(calls.promo).toEqual(['CINE10']);
    expect(total()).toHaveTextContent('165.000đ');
    expect(screen.getByText('-30.000đ')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Gỡ' }));
    await waitFor(() => expect(total()).toHaveTextContent('195.000đ'));
    expect(screen.queryByText(/Đã áp dụng/)).not.toBeInTheDocument();
  });

  it('đổi combo làm server tự gỡ mã (không còn đủ điều kiện): có thông báo cho người dùng', async () => {
    const promo = { code: 'GIAM30K', name: 'Giảm', discount: 30_000 };
    const state = { order: makeOrder({ promotion: promo, discount: 30_000, total: 165_000 }), nextOrder: () => makeOrder() }; // server trả đơn KHÔNG còn mã
    backend(state);
    const user = userEvent.setup();
    renderPage(routes, ROUTE);
    await screen.findByText(/Đã áp dụng/);
    await user.click(screen.getByRole('button', { name: 'Tăng Combo Solo' }));
    expect(await screen.findByText('Mã khuyến mãi đã được gỡ vì đơn không còn đủ điều kiện.', {}, { timeout: 2500 })).toBeInTheDocument();
  });

  it('⭐ Thanh toán: tạo giao dịch rồi chuyển sang trang VNPay do server cấp', async () => {
    const calls = backend({ order: makeOrder(), paymentUrl: 'https://sandbox.vnpayment.vn/pay?vnp_TxnRef=K7Q2M9XA-1' });
    const user = userEvent.setup();
    renderPage(routes, ROUTE);
    await screen.findByText('Phim thử');
    await user.click(payBtn());
    await waitFor(() => expect(goToGateway).toHaveBeenCalledWith('https://sandbox.vnpayment.vn/pay?vnp_TxnRef=K7Q2M9XA-1'));
    expect(calls.payments).toBe(1);
  });

  it('liên kết thanh toán không hợp lệ: báo lỗi, mở lại nút (không bị treo)', async () => {
    vi.mocked(goToGateway).mockReturnValue(false);
    backend({ order: makeOrder(), paymentUrl: 'javascript:alert(1)' });
    const user = userEvent.setup();
    renderPage(routes, ROUTE);
    await screen.findByText('Phim thử');
    await user.click(payBtn());
    expect(await screen.findByRole('alert')).toHaveTextContent('Liên kết thanh toán không hợp lệ');
    expect(payBtn()).toBeEnabled();
  });

  it('chế độ giả lập (chỉ dev): gọi cổng giả lập rồi sang trang kết quả với mã giao dịch', async () => {
    vi.mocked(paymentSimulatorEnabled).mockReturnValue(true);
    const calls = backend({ order: makeOrder() });
    const user = userEvent.setup();
    renderPage(routes, ROUTE);
    await screen.findByText('Phim thử');
    await user.click(payBtn());
    expect(await screen.findByText('TRANG KẾT QUẢ')).toBeInTheDocument();
    expect(calls.simulate).toEqual(['K7Q2M9XA-1']);
    expect(goToGateway).not.toHaveBeenCalled();
    expect(screen.getByTestId('where')).toHaveTextContent('/payment/result?txnRef=K7Q2M9XA-1');
  });

  it('⭐ đơn hết hạn khi đang thao tác (ORDER_EXPIRED): hộp thoại hết giờ, dẫn về chọn lại ghế', async () => {
    backend({ order: makeOrder(), payError: { status: 410, code: 'ORDER_EXPIRED' } });
    const user = userEvent.setup();
    renderPage(routes, ROUTE);
    await screen.findByText('Phim thử');
    await user.click(payBtn());
    const dialog = await screen.findByRole('dialog', { name: 'Đã hết thời gian giữ ghế' });
    await user.click(screen.getByRole('button', { name: 'Chọn lại ghế' }));
    expect(await screen.findByText('TRANG CHỌN GHẾ')).toBeInTheDocument();
    expect(dialog).toBeTruthy();
  });

  it('⭐ đồng hồ về 0: hộp thoại "Đã hết thời gian giữ ghế" tự hiện và khóa các nút', async () => {
    backend({ order: makeOrder({ expiresAt: new Date(Date.now() + 1200).toISOString() }) });
    renderPage(routes, ROUTE);
    await screen.findByText('Phim thử');
    expect(screen.queryByRole('dialog', { name: 'Đã hết thời gian giữ ghế' })).not.toBeInTheDocument();
    expect(await screen.findByRole('dialog', { name: 'Đã hết thời gian giữ ghế' }, { timeout: 4000 })).toBeInTheDocument();
    expect(payBtn()).toBeDisabled();
  });

  it('Hủy đơn: hỏi xác nhận; "Không, giữ đơn" thì không hủy; xác nhận thì hủy và về chọn ghế', async () => {
    const calls = backend({ order: makeOrder() });
    const user = userEvent.setup();
    renderPage(routes, ROUTE);
    await screen.findByText('Phim thử');
    await user.click(screen.getByRole('button', { name: 'Hủy đơn' }));
    await user.click(await screen.findByRole('button', { name: 'Không, giữ đơn' }));
    expect(calls.cancels).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Hủy đơn' }));
    const dialog = await screen.findByRole('dialog', { name: 'Hủy đơn hàng?' });
    await user.click(within(dialog).getByRole('button', { name: 'Hủy đơn' }));
    expect(await screen.findByText('TRANG CHỌN GHẾ')).toBeInTheDocument();
    expect(calls.cancels).toBe(1);
  });

  it('đơn đã thanh toán (PAID): chuyển thẳng tới trang vé', async () => {
    backend({ order: makeOrder({ status: 'PAID' }) });
    renderPage(routes, ROUTE);
    expect(await screen.findByText('TRANG VÉ')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/me/tickets/K7Q2M9XA');
  });

  it.each([
    ['CANCELLED', 'Đơn hàng đã được hủy'],
    ['EXPIRED', 'Đơn hàng đã hết hạn giữ ghế'],
    ['REFUND_PENDING', 'Đơn hàng đang chờ hoàn tiền'],
    ['REFUNDED', 'Đơn hàng đã được hoàn tiền'],
  ])('đơn %s: hiện màn hình giải thích, không có nút thanh toán', async (status, title) => {
    backend({ order: makeOrder({ status }) });
    renderPage(routes, ROUTE);
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Thanh toán/ })).not.toBeInTheDocument();
  });

  it('đơn của người khác (FORBIDDEN) hoặc không tồn tại: trang 404', async () => {
    backend({ getError: { status: 403, code: 'FORBIDDEN' } });
    renderPage(routes, ROUTE);
    expect(await screen.findByText('Không tìm thấy trang')).toBeInTheDocument();
  });
});

import { within } from '@testing-library/react';
