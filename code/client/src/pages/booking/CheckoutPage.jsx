import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  useApplyPromotion, useCancelOrder, useCreatePayment, useOrder, useRemovePromotion, useSetCombos,
} from '@/hooks/useBooking';
import { useCountdown } from '@/hooks/useCountdown';
import { useDebounce } from '@/hooks/useDebounce';
import { simulatePayment } from '@/api/booking.api';
import { errorMessage, hasCode } from '@/api/errors';
import { formatCountdown } from '@/lib/clock';
import { goToGateway, paymentSimulatorEnabled } from '@/lib/navigation';
import ComboPicker from '@/components/booking/ComboPicker';
import OrderSummary from '@/components/booking/OrderSummary';
import PromoBox from '@/components/booking/PromoBox';
import Button from '@/components/ui/Button';
import ErrorState from '@/components/ui/ErrorState';
import Modal from '@/components/ui/Modal';
import { PageSpinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { NotFoundPage } from '@/pages/common/StatusPages';

/** [{ comboId, quantity }] chỉ gồm combo có số lượng > 0, xếp ổn định — để so sánh "đã đồng bộ với server chưa". */
const itemsOf = (quantities) => Object.entries(quantities).filter(([, q]) => q > 0).sort(([a], [b]) => a.localeCompare(b)).map(([comboId, quantity]) => ({ comboId, quantity }));
const keyOf = (quantities) => JSON.stringify(itemsOf(quantities));
const quantitiesOf = (order) => Object.fromEntries(order.combos.map((c) => [c.comboId, c.quantity]));

/** Màn hình cho đơn không còn ở trạng thái chờ thanh toán. */
function ClosedOrder({ order }) {
  const back = `/booking/showtimes/${order.showtime.id}`;
  const text = {
    CANCELLED: ['Đơn hàng đã được hủy', 'Ghế đã được nhả. Bạn có thể chọn lại ghế.'],
    EXPIRED: ['Đơn hàng đã hết hạn giữ ghế', 'Ghế đã được nhả. Bạn có thể chọn lại ghế.'],
    REFUND_PENDING: ['Đơn hàng đang chờ hoàn tiền', 'Chúng tôi đã nhận thanh toán nhưng không giữ được ghế. Nhân viên sẽ hoàn tiền cho bạn; vui lòng liên hệ rạp nếu cần hỗ trợ.'],
    REFUNDED: ['Đơn hàng đã được hoàn tiền', 'Khoản thanh toán của bạn đã được hoàn lại.'],
  }[order.status] ?? ['Đơn hàng không còn chờ thanh toán', ''];
  return (
    <div className="mx-auto max-w-lg space-y-3 py-10 text-center">
      <h1 className="text-2xl font-bold">{text[0]}</h1>
      <p className="text-ink-300">{text[1]}</p>
      <Link to={back} className="inline-flex h-11 items-center rounded-lg bg-brand-600 px-5 font-semibold text-white hover:bg-brand-500">Chọn lại ghế</Link>
    </div>
  );
}

/**
 * P06 — Thanh toán ⭐. Nguyên tắc:
 * - Mọi con số tiền do SERVER trả về sau mỗi thay đổi (combo / mã); giao diện chỉ hiển thị.
 * - Đếm ngược theo hạn `expiresAt` của server (và đồng hồ server, không phải đồng hồ máy người dùng).
 * - Nút "Thanh toán" bị khóa cho tới khi combo đã đồng bộ với server: link thanh toán gắn với tổng tiền LÚC TẠO, nên không
 *   được tạo link khi tổng tiền còn đang thay đổi.
 */
export default function CheckoutPage() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: order, isPending, isError, error, refetch } = useOrder(orderId);

  const setCombos = useSetCombos();
  const applyPromo = useApplyPromotion();
  const removePromo = useRemovePromotion();
  const cancel = useCancelOrder();
  const pay = useCreatePayment();

  const [quantities, setQuantities] = useState(null); // null: chưa nạp từ đơn
  const [expired, setExpired] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [paying, setPaying] = useState(false);
  const debounced = useDebounce(quantities, 500);
  const initialised = useRef(false);

  const pending = order?.status === 'PENDING';
  const remaining = useCountdown(pending ? order.expiresAt : null, () => setExpired(true));

  // Nạp số lượng combo từ đơn đúng một lần.
  useEffect(() => {
    if (order && !initialised.current) { initialised.current = true; setQuantities(quantitiesOf(order)); }
  }, [order]);

  const synced = Boolean(order && quantities && keyOf(quantities) === keyOf(quantitiesOf(order)));

  // Đồng bộ combo lên server sau khi người dùng ngừng bấm; không gửi chồng khi một yêu cầu đang chạy.
  useEffect(() => {
    if (!order || !debounced || setCombos.isPending || keyOf(debounced) === keyOf(quantitiesOf(order))) return;
    const hadPromo = Boolean(order.promotion);
    setCombos.mutate({ orderId, items: itemsOf(debounced) }, {
      onSuccess: (next) => {
        if (hadPromo && !next.promotion) toast.info('Mã khuyến mãi đã được gỡ vì đơn không còn đủ điều kiện.');
      },
      onError: (err) => {
        if (hasCode(err, 'ORDER_EXPIRED')) setExpired(true);
        else toast.error(errorMessage(err));
        setQuantities(quantitiesOf(order)); // trả về trạng thái server đang có
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ phản ứng khi giá trị đã debounce hoặc trạng thái gửi đổi
  }, [debounced, setCombos.isPending]);

  if (isError && (hasCode(error, 'NOT_FOUND') || hasCode(error, 'FORBIDDEN') || hasCode(error, 'VALIDATION_ERROR'))) return <NotFoundPage />;
  if (isError) return <ErrorState error={error} onRetry={refetch} />;
  if (isPending) return <PageSpinner label="Đang tải đơn hàng" />;
  if (order.status === 'PAID') return <Navigate to={`/me/tickets/${order.code}`} replace />;
  if (!pending) return <ClosedOrder order={order} />;

  const seatsUrl = `/booking/showtimes/${order.showtime.id}`;
  const busy = setCombos.isPending || !synced || applyPromo.isPending || removePromo.isPending || cancel.isPending || paying;

  const handleActionError = (err) => {
    if (hasCode(err, 'ORDER_EXPIRED')) setExpired(true);
    else if (hasCode(err, 'ORDER_NOT_PENDING')) refetch(); // đơn đã đổi trạng thái (vd đã thanh toán ở tab khác)
    else toast.error(errorMessage(err));
  };

  const onPay = () => {
    setPaying(true);
    pay.mutate({ orderId }, {
      onSuccess: async (payment) => {
        if (paymentSimulatorEnabled()) {
          try {
            await simulatePayment(payment.txnRef, 'SUCCESS'); // giả lập VNPay gọi IPN (chỉ dev)
            navigate(`/payment/result?txnRef=${encodeURIComponent(payment.txnRef)}`);
          } catch (err) {
            setPaying(false);
            toast.error(errorMessage(err));
          }
          return;
        }
        if (!goToGateway(payment.paymentUrl)) { setPaying(false); toast.error('Liên kết thanh toán không hợp lệ.'); }
      },
      onError: (err) => { setPaying(false); handleActionError(err); },
    });
  };

  const onCancel = () => {
    cancel.mutate({ orderId }, {
      onSuccess: () => { toast.success('Đã hủy đơn và nhả ghế.'); navigate(seatsUrl, { replace: true }); },
      onError: (err) => { setConfirmCancel(false); handleActionError(err); },
    });
  };

  return (
    <div className="space-y-6">
      <div
        role="timer" aria-label="Thời gian giữ ghế còn lại"
        className={`flex items-center justify-center gap-3 rounded-xl border px-4 py-3 text-lg font-bold ${remaining < 60_000 ? 'border-bad/60 bg-bad/10 text-red-300' : 'border-ink-600 bg-ink-900'}`}
      >
        <span aria-hidden="true">⏱</span>
        <span>Thời gian giữ ghế còn lại: <span data-testid="countdown" className="tabular-nums">{formatCountdown(remaining)}</span></span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-8">
          <section aria-labelledby="combo-title">
            <h2 id="combo-title" className="mb-3 text-xl font-bold">Combo bắp nước</h2>
            <ComboPicker quantities={quantities ?? {}} onChange={setQuantities} disabled={expired || paying} />
          </section>
          <section aria-labelledby="promo-title">
            <h2 id="promo-title" className="mb-3 text-xl font-bold">Khuyến mãi</h2>
            <PromoBox
              promotion={order.promotion} discount={order.discount} disabled={expired || paying || setCombos.isPending}
              applying={applyPromo.isPending} removing={removePromo.isPending}
              onApply={(code) => applyPromo.mutateAsync({ orderId, code }).catch((err) => {
                if (hasCode(err, 'ORDER_EXPIRED') || hasCode(err, 'ORDER_NOT_PENDING')) handleActionError(err);
                throw err;
              })}
              onRemove={() => removePromo.mutate({ orderId }, { onError: handleActionError })}
            />
          </section>
        </div>

        <aside aria-label="Tóm tắt đơn" className="h-fit space-y-4 rounded-2xl border border-ink-700 bg-ink-900 p-5 lg:sticky lg:top-20">
          <h2 className="text-xl font-bold">Tóm tắt đơn</h2>
          <OrderSummary order={order} />
          <p aria-live="polite" className="text-xs text-ink-300">{busy && !paying ? 'Đang cập nhật tổng tiền...' : ' '}</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setConfirmCancel(true)} disabled={paying || expired}>Hủy đơn</Button>
            <Button size="lg" className="flex-1" onClick={onPay} loading={paying} disabled={busy || expired}>Thanh toán →</Button>
          </div>
        </aside>
      </div>

      <Modal
        open={expired} dismissible={false} title="Đã hết thời gian giữ ghế"
        footer={<Button onClick={() => navigate(seatsUrl, { replace: true })}>Chọn lại ghế</Button>}
      >
        Ghế của bạn đã được nhả để người khác có thể đặt. Vui lòng chọn lại ghế.
      </Modal>

      <Modal
        open={confirmCancel} onClose={() => setConfirmCancel(false)} title="Hủy đơn hàng?"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setConfirmCancel(false)}>Không, giữ đơn</Button>
            <Button variant="danger" loading={cancel.isPending} onClick={onCancel}>Hủy đơn</Button>
          </>
        )}
      >
        Ghế bạn đang giữ sẽ được nhả ngay và người khác có thể đặt.
      </Modal>
    </div>
  );
}
