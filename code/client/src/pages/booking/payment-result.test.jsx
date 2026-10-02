import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http } from 'msw';
import { setupServer } from 'msw/node';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PaymentResultPage, { isFinal } from './PaymentResultPage';
import { err, ok, renderPage } from '@/test/helpers';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

const status = (orderStatus, paymentStatus, orderId = 'o1') => ({ orderId, orderStatus, paymentStatus });
const routes = (props = {}) => [{ path: '/payment/result', element: <PaymentResultPage pollMs={40} maxWaitMs={400} {...props} /> }];
const ROUTE = '/payment/result?txnRef=K7Q2M9XA-1';

/** `sequence`: các phản hồi lần lượt; lần cuối được lặp lại. Trả về số lần server bị hỏi. */
function backend(sequence, { order = { id: 'o1', code: 'K7Q2M9XA' } } = {}) {
  const calls = { status: 0 };
  server.use(
    http.get('/api/v1/payments/:txnRef/status', () => {
      const item = sequence[Math.min(calls.status++, sequence.length - 1)];
      return item instanceof Response ? item : ok(item);
    }),
    http.get('/api/v1/orders/:id', () => ok(order)),
  );
  return calls;
}

describe('isFinal', () => {
  it('chưa có kết luận khi đơn và giao dịch đều đang chờ', () => expect(isFinal(status('PENDING', 'PENDING'))).toBe(false));
  it('có kết luận khi đơn đổi trạng thái hoặc giao dịch thất bại', () => {
    expect(isFinal(status('PAID', 'SUCCESS'))).toBe(true);
    expect(isFinal(status('PENDING', 'FAILED'))).toBe(true);
    expect(isFinal(status('EXPIRED', 'PENDING'))).toBe(true);
    expect(isFinal(undefined)).toBe(false);
  });
});

describe('PaymentResultPage (P07)', () => {
  it('đơn đã PAID: báo thành công và có liên kết tới vé (theo mã đơn)', async () => {
    backend([status('PAID', 'SUCCESS')]);
    renderPage(routes(), ROUTE);
    expect(await screen.findByRole('heading', { name: 'Đặt vé thành công!' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Xem vé' })).toHaveAttribute('href', '/me/tickets/K7Q2M9XA');
  });

  it('⭐ hỏi server ĐỊNH KỲ: lúc đầu đang chờ, vài giây sau IPN xong thì tự chuyển sang thành công', async () => {
    const calls = backend([status('PENDING', 'PENDING'), status('PENDING', 'PENDING'), status('PAID', 'SUCCESS')]);
    renderPage(routes(), ROUTE);
    expect(await screen.findByRole('heading', { name: 'Đang xác nhận thanh toán...' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Đặt vé thành công!' })).toBeInTheDocument();
    expect(calls.status).toBeGreaterThanOrEqual(3);
  });

  it('⭐ KHÔNG tin tham số trên URL: vnp_ResponseCode=00 giả mạo vẫn không cho "thành công" nếu server chưa xác nhận', async () => {
    backend([status('PENDING', 'PENDING')]);
    renderPage(routes(), '/payment/result?vnp_TxnRef=K7Q2M9XA-1&vnp_ResponseCode=00&vnp_TransactionStatus=00&vnp_Amount=19500000');
    expect(await screen.findByRole('heading', { name: 'Đang xác nhận thanh toán...' })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.queryByRole('heading', { name: 'Đặt vé thành công!' })).not.toBeInTheDocument();
  });

  it('dùng vnp_TxnRef do VNPay trả về để hỏi trạng thái', async () => {
    const seen = [];
    server.use(http.get('/api/v1/payments/:txnRef/status', ({ params }) => { seen.push(params.txnRef); return ok(status('PAID', 'SUCCESS')); }), http.get('/api/v1/orders/:id', () => ok({ id: 'o1', code: 'ABC' })));
    renderPage(routes(), '/payment/result?vnp_TxnRef=ABC-2&vnp_ResponseCode=00');
    await screen.findByRole('heading', { name: 'Đặt vé thành công!' });
    expect(seen[0]).toBe('ABC-2');
  });

  it('thanh toán thất bại (đơn còn hạn): báo chưa thành công, cho thử lại ở trang thanh toán', async () => {
    backend([status('PENDING', 'FAILED')]);
    renderPage(routes(), ROUTE);
    expect(await screen.findByRole('heading', { name: 'Thanh toán chưa thành công' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Thử lại' })).toHaveAttribute('href', '/booking/orders/o1');
  });

  it('⭐ đơn đã hết hạn / bị hủy: báo hết hạn giữ ghế kèm dặn liên hệ nếu đã bị trừ tiền', async () => {
    backend([status('EXPIRED', 'PENDING')]);
    renderPage(routes(), ROUTE);
    expect(await screen.findByRole('heading', { name: 'Đơn hàng đã hết hạn giữ ghế' })).toBeInTheDocument();
    expect(screen.getByText(/bị trừ tiền/)).toBeInTheDocument();
  });

  it('⭐ REFUND_PENDING (thanh toán đến muộn, ghế đã mất): giải thích rõ và nói sẽ hoàn tiền', async () => {
    backend([status('REFUND_PENDING', 'SUCCESS')]);
    renderPage(routes(), ROUTE);
    expect(await screen.findByRole('heading', { name: 'Đã nhận thanh toán nhưng không giữ được ghế' })).toBeInTheDocument();
    expect(screen.getByText(/hoàn tiền/)).toBeInTheDocument();
  });

  it('chờ quá lâu mà vẫn chưa có xác nhận: dừng hỏi, báo rõ và có nút "Kiểm tra lại" bắt đầu đợt chờ mới', async () => {
    const calls = backend([status('PENDING', 'PENDING')]);
    const user = userEvent.setup();
    renderPage(routes({ maxWaitMs: 200 }), ROUTE);
    expect(await screen.findByRole('heading', { name: 'Chưa nhận được xác nhận thanh toán' }, { timeout: 2000 })).toBeInTheDocument();
    const stoppedAt = calls.status;
    await new Promise((r) => setTimeout(r, 200));
    expect(calls.status).toBe(stoppedAt); // đã ngừng hỏi

    await user.click(screen.getByRole('button', { name: 'Kiểm tra lại' }));
    await waitFor(() => expect(calls.status).toBeGreaterThan(stoppedAt));
  });

  it('thiếu mã giao dịch trên URL: báo không tìm thấy, không gọi server', async () => {
    let called = false;
    server.use(http.get('/api/v1/payments/:txnRef/status', () => { called = true; return ok(status('PAID', 'SUCCESS')); }));
    renderPage(routes(), '/payment/result');
    expect(await screen.findByRole('heading', { name: 'Không tìm thấy giao dịch' })).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it('giao dịch không tồn tại / không phải của mình (NOT_FOUND): báo không tìm thấy', async () => {
    backend([err(404, 'NOT_FOUND', 'x')]);
    renderPage(routes(), ROUTE);
    expect(await screen.findByRole('heading', { name: 'Không tìm thấy giao dịch' })).toBeInTheDocument();
  });

  it('lỗi máy chủ: trạng thái lỗi có nút thử lại', async () => {
    backend([err(500, 'INTERNAL_ERROR', 'x')]);
    renderPage(routes(), ROUTE);
    expect(await screen.findByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
  });
});
