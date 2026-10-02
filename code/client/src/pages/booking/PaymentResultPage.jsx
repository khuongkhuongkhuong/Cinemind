import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getPaymentStatus } from '@/api/booking.api';
import { hasCode } from '@/api/errors';
import { useOrder } from '@/hooks/useBooking';
import Button from '@/components/ui/Button';
import ErrorState from '@/components/ui/ErrorState';
import Spinner from '@/components/ui/Spinner';

export const POLL_MS = 2000; // hỏi server mỗi 2 giây
export const MAX_WAIT_MS = 30_000; // tối đa 30 giây (05-ui-pages P07)

/** Đã có kết luận cuối cùng từ server chưa? (không cần hỏi nữa) */
export const isFinal = (s) => Boolean(s) && (s.orderStatus !== 'PENDING' || s.paymentStatus !== 'PENDING');

function Panel({ icon, title, children, actions, tone = 'ink' }) {
  const border = { ok: 'border-ok/50', bad: 'border-bad/50', warn: 'border-warn/50', ink: 'border-ink-600' }[tone];
  return (
    <div role="status" className={`mx-auto max-w-lg space-y-3 rounded-2xl border ${border} bg-ink-900 p-8 text-center`}>
      <div className="text-5xl" aria-hidden="true">{icon}</div>
      <h1 className="text-2xl font-bold">{title}</h1>
      <div className="text-ink-300">{children}</div>
      {actions && <div className="flex flex-wrap justify-center gap-2 pt-2">{actions}</div>}
    </div>
  );
}
const linkBtn = 'inline-flex h-11 items-center rounded-lg bg-brand-600 px-5 font-semibold text-white hover:bg-brand-500';
const linkBtn2 = 'inline-flex h-11 items-center rounded-lg border border-ink-500 px-5 font-semibold hover:bg-ink-700';

/**
 * P07 — Kết quả thanh toán ⭐. Trang này CHỈ ĐỌC trạng thái từ server (hỏi mỗi 2 giây, tối đa 30 giây).
 * Nó tuyệt đối KHÔNG tin các tham số trên URL (vd `vnp_ResponseCode=00`): bất kỳ ai cũng gõ được URL đó. Chỉ IPN của VNPay
 * (đã kiểm chữ ký + số tiền) mới đổi đơn sang PAID, và trang này chỉ phản ánh điều server đã ghi nhận.
 */
export default function PaymentResultPage({ pollMs = POLL_MS, maxWaitMs = MAX_WAIT_MS }) {
  const [params] = useSearchParams();
  const txnRef = params.get('vnp_TxnRef') ?? params.get('txnRef'); // VNPay trả về vnp_TxnRef; luồng giả lập dùng txnRef
  const startedAt = useRef(Date.now());
  const [attempt, setAttempt] = useState(0); // tăng khi người dùng bấm "Kiểm tra lại" để bắt đầu một đợt chờ mới

  const status = useQuery({
    queryKey: ['paymentStatus', txnRef, attempt],
    queryFn: () => getPaymentStatus(txnRef),
    enabled: Boolean(txnRef),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchInterval: (query) => (isFinal(query.state.data) || Date.now() - startedAt.current > maxWaitMs ? false : pollMs),
  });
  const data = status.data;
  const paid = data?.orderStatus === 'PAID';
  const order = useOrder(paid ? data.orderId : null); // cần mã đơn để dẫn tới trang vé

  const checkAgain = () => { startedAt.current = Date.now(); setAttempt((a) => a + 1); };

  if (!txnRef) {
    return <Panel icon="❓" title="Không tìm thấy giao dịch" tone="warn" actions={<Link to="/" className={linkBtn}>Về trang chủ</Link>}>Đường dẫn thiếu mã giao dịch.</Panel>;
  }
  if (status.isError && hasCode(status.error, 'NOT_FOUND')) {
    return <Panel icon="❓" title="Không tìm thấy giao dịch" tone="warn" actions={<Link to="/me/tickets" className={linkBtn}>Vé của tôi</Link>}>Giao dịch này không tồn tại hoặc không phải của bạn.</Panel>;
  }
  if (status.isError) return <ErrorState error={status.error} title="Không kiểm tra được thanh toán" onRetry={checkAgain} />;

  if (paid) {
    return (
      <Panel icon="✅" tone="ok" title="Đặt vé thành công!"
        actions={order.data ? <Link to={`/me/tickets/${order.data.code}`} className={linkBtn}>Xem vé</Link> : <Link to="/me/tickets" className={linkBtn}>Vé của tôi</Link>}>
        Thanh toán đã được xác nhận. Vé và mã QR của bạn đã sẵn sàng.
      </Panel>
    );
  }

  if (data?.orderStatus === 'REFUND_PENDING') {
    return (
      <Panel icon="⚠️" tone="warn" title="Đã nhận thanh toán nhưng không giữ được ghế" actions={<Link to="/" className={linkBtn2}>Về trang chủ</Link>}>
        Ghế của bạn đã bị đặt trước khi thanh toán được xác nhận. Chúng tôi sẽ hoàn tiền; vui lòng liên hệ rạp nếu cần hỗ trợ.
      </Panel>
    );
  }
  if (data?.orderStatus === 'EXPIRED' || data?.orderStatus === 'CANCELLED') {
    return (
      <Panel icon="⌛" tone="warn" title="Đơn hàng đã hết hạn giữ ghế" actions={<Link to="/movies" className={linkBtn}>Chọn phim khác</Link>}>
        Ghế đã được nhả. Nếu bạn đã bị trừ tiền, vui lòng liên hệ rạp để được hỗ trợ.
      </Panel>
    );
  }
  if (data?.paymentStatus === 'FAILED') {
    return (
      <Panel icon="❌" tone="bad" title="Thanh toán chưa thành công"
        actions={<><Link to={`/booking/orders/${data.orderId}`} className={linkBtn}>Thử lại</Link><Link to="/movies" className={linkBtn2}>Chọn phim khác</Link></>}>
        Bạn chưa bị trừ tiền. Nếu đơn còn hạn giữ ghế, bạn có thể thanh toán lại.
      </Panel>
    );
  }

  // Còn đang chờ (hoặc đã chờ quá lâu)
  const waitedTooLong = status.dataUpdatedAt > 0 && Date.now() - startedAt.current > maxWaitMs && !isFinal(data);
  if (waitedTooLong) {
    return (
      <Panel icon="⏳" tone="warn" title="Chưa nhận được xác nhận thanh toán"
        actions={<><Button onClick={checkAgain}>Kiểm tra lại</Button><Link to="/me/tickets" className={linkBtn2}>Vé của tôi</Link></>}>
        Việc xác nhận đôi khi mất thêm ít phút. Nếu bạn đã thanh toán, vé sẽ xuất hiện trong "Vé của tôi" khi hoàn tất.
      </Panel>
    );
  }
  return (
    <Panel icon={<Spinner className="mx-auto h-12 w-12 text-brand-500" label="Đang xác nhận thanh toán" />} title="Đang xác nhận thanh toán...">
      Vui lòng không đóng trang này. Chúng tôi đang chờ ngân hàng xác nhận.
    </Panel>
  );
}
