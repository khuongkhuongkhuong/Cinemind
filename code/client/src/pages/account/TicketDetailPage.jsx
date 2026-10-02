import { useParams, Link } from 'react-router-dom';
import { useMyTicket } from '@/hooks/useTickets';
import { hasCode } from '@/api/errors';
import { formatDateTime, formatMoney } from '@/lib/format';
import { audioLabel, formatLabel } from '@/lib/movies';
import { formatTicketCode, orderStatusInfo, ticketUsage } from '@/lib/tickets';
import OrderSummary from '@/components/booking/OrderSummary';
import AgeBadge from '@/components/ui/AgeBadge';
import ErrorState from '@/components/ui/ErrorState';
import QrCode from '@/components/ui/QrCode';
import Skeleton from '@/components/ui/Skeleton';
import { NotFoundPage } from '@/pages/common/StatusPages';

const USAGE_TEXT = {
  UPCOMING: ['Chưa sử dụng', 'text-ok'],
  USED: ['Đã sử dụng', 'text-ink-300'],
  PAST: ['Suất chiếu đã kết thúc', 'text-ink-300'],
};

/** P11 — Chi tiết vé + mã QR. QR chỉ có khi đơn đã thanh toán (server trả `qrContent`). */
export default function TicketDetailPage() {
  const { code } = useParams();
  const { data: order, isPending, isError, error, refetch } = useMyTicket(code);

  if (isError && (hasCode(error, 'NOT_FOUND') || hasCode(error, 'VALIDATION_ERROR'))) return <NotFoundPage />;
  if (isError) return <ErrorState error={error} onRetry={refetch} />;
  if (isPending) return <div className="mx-auto max-w-md space-y-4"><Skeleton className="h-72" /><Skeleton className="h-48" /></div>;

  const info = orderStatusInfo(order.status);
  const usage = ticketUsage(order);
  const { showtime } = order;

  return (
    <div className="mx-auto max-w-md space-y-5">
      <Link to="/me/tickets" className="text-sm text-ink-300 hover:text-brand-600">← Vé của tôi</Link>

      <article aria-label={`Vé ${order.code}`} className="overflow-hidden rounded-2xl border border-ink-600 bg-ink-900">
        <div className="space-y-4 p-6 text-center">
          {order.qrContent ? (
            <>
              <div className="flex justify-center"><QrCode value={order.qrContent} label={`Mã QR của vé ${order.code}`} /></div>
              <p className="text-sm text-ink-300">Đưa mã này cho nhân viên soát vé tại cửa</p>
            </>
          ) : (
            <p role="note" className="rounded-lg border border-ink-600 bg-ink-800 px-3 py-4 text-ink-300">
              Đơn này <strong className="text-ink-100">{info.label.toLowerCase()}</strong> nên không có mã QR để vào rạp.
            </p>
          )}
          <div>
            <p className="text-xs uppercase tracking-wider text-ink-300">Mã đặt vé</p>
            <p data-testid="ticket-code" className="font-mono text-2xl font-black tracking-widest">{formatTicketCode(order.code)}</p>
          </div>
        </div>

        <div className="space-y-3 border-t border-dashed border-ink-600 p-6 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold">{showtime.movie.title}</h1>
            <AgeBadge rating={showtime.movie.ageRating} />
          </div>
          <p className="text-ink-300">{formatDateTime(showtime.startTime)} · {formatLabel(showtime.format)} {audioLabel(showtime.audio)}</p>
          <p className="text-ink-300">{showtime.cinema.name} · {showtime.room.name}</p>
          <p>Ghế: <strong>{order.seats.map((s) => s.label).join(', ')}</strong></p>
          {order.combos.length > 0 && <p>Combo: {order.combos.map((c) => `${c.quantity} × ${c.name}`).join(', ')}</p>}
          <p>Tổng: <strong className="text-gold-400">{formatMoney(order.total)}</strong> · {info.label}</p>
          {usage && (
            <p className={`font-semibold ${USAGE_TEXT[usage][1]}`}>
              Trạng thái: {USAGE_TEXT[usage][0]}
              {order.checkedInAt && <span className="font-normal"> (lúc {formatDateTime(order.checkedInAt)})</span>}
            </p>
          )}
        </div>
      </article>

      {order.status === 'PENDING' && (
        <Link to={`/booking/orders/${order.id}`} className="flex h-12 items-center justify-center rounded-lg bg-brand-600 font-semibold text-white hover:bg-brand-500">Tiếp tục thanh toán</Link>
      )}
      {order.status === 'REFUND_PENDING' && (
        <p role="note" className="rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-gold-400">
          Chúng tôi đã nhận thanh toán nhưng không giữ được ghế. Nhân viên sẽ hoàn tiền cho bạn.
        </p>
      )}

      <details className="rounded-2xl border border-ink-700 bg-ink-900 p-4">
        <summary className="cursor-pointer font-semibold">Chi tiết thanh toán</summary>
        <div className="mt-4"><OrderSummary order={order} /></div>
      </details>
    </div>
  );
}
