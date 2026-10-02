import { Link, useSearchParams } from 'react-router-dom';
import { useMyOrders } from '@/hooks/useTickets';
import { formatDateTime, formatMoney } from '@/lib/format';
import { audioLabel, formatLabel } from '@/lib/movies';
import { formatTicketCode, orderStatusInfo, ticketUsage } from '@/lib/tickets';
import AgeBadge from '@/components/ui/AgeBadge';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import Pagination from '@/components/ui/Pagination';
import SelectField from '@/components/ui/SelectField';
import Skeleton from '@/components/ui/Skeleton';

const STATUSES = ['PAID', 'PENDING', 'CANCELLED', 'EXPIRED', 'REFUND_PENDING', 'REFUNDED'];
const TONE = { ok: 'bg-ok/20 text-ok border-ok/40', warn: 'bg-warn/20 text-gold-400 border-warn/40', muted: 'bg-ink-700 text-ink-300 border-ink-500' };
const USAGE = {
  UPCOMING: { label: 'Chưa sử dụng', tone: 'ok' },
  USED: { label: 'Đã sử dụng', tone: 'muted' },
  PAST: { label: 'Suất đã chiếu', tone: 'muted' },
};

function Badge({ tone, children }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONE[tone]}`}>{children}</span>;
}

function TicketCard({ order }) {
  const { showtime } = order;
  const info = orderStatusInfo(order.status);
  const usage = ticketUsage(order);
  // Đơn chờ thanh toán dẫn về trang thanh toán (còn trong thời gian giữ ghế); các đơn khác dẫn tới trang vé.
  const href = order.status === 'PENDING' ? `/booking/orders/${order.id}` : `/me/tickets/${order.code}`;
  return (
    <li>
      <Link to={href} className="block rounded-2xl border border-ink-700 bg-ink-900 p-4 transition-colors hover:border-ink-500 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-bold">{showtime.movie.title}</h2>
              <AgeBadge rating={showtime.movie.ageRating} />
            </div>
            <p className="mt-1 text-sm text-ink-300">{formatDateTime(showtime.startTime)} · {formatLabel(showtime.format)} {audioLabel(showtime.audio)}</p>
            <p className="text-sm text-ink-300">{showtime.cinema.name} · {showtime.room.name}</p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Badge tone={info.tone}>{info.label}</Badge>
            {usage && <Badge tone={USAGE[usage].tone}>{USAGE[usage].label}</Badge>}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-ink-700 pt-3 text-sm">
          <span>Ghế: <strong>{order.seatLabels.join(', ')}</strong></span>
          <span className="text-ink-300">Mã vé <strong className="font-mono text-ink-100">{formatTicketCode(order.code)}</strong></span>
          <span className="font-bold text-gold-400">{formatMoney(order.total)}</span>
        </div>
      </Link>
    </li>
  );
}

/** P10 — Vé của tôi. Bộ lọc trạng thái và trang nằm trên URL. */
export default function TicketsPage() {
  const [params, setParams] = useSearchParams();
  const status = STATUSES.includes(params.get('status')) ? params.get('status') : 'PAID';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const { data, isPending, isError, error, refetch } = useMyOrders({ status, page, pageSize: 10 });

  const change = (changes) => setParams((p) => {
    const next = new URLSearchParams(p);
    for (const [k, v] of Object.entries(changes)) { if (v) next.set(k, v); else next.delete(k); }
    return next;
  }, { replace: true });

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl font-black">Vé của tôi</h1>
        <SelectField label="Trạng thái" hideLabel value={status} onChange={(e) => change({ status: e.target.value === 'PAID' ? '' : e.target.value, page: '' })} className="w-52">
          {STATUSES.map((s) => <option key={s} value={s}>{orderStatusInfo(s).label}</option>)}
        </SelectField>
      </div>

      <div className="mt-6" aria-live="polite">
        {isError ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : isPending ? (
          <div className="space-y-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-32" />)}</div>
        ) : data.items.length === 0 ? (
          <EmptyState
            title={status === 'PAID' ? 'Bạn chưa có vé nào' : 'Không có đơn nào ở trạng thái này'}
            description={status === 'PAID' ? 'Chọn một bộ phim và đặt vé đầu tiên của bạn.' : undefined}
            action={status === 'PAID' ? <Link to="/movies" className="inline-flex h-11 items-center rounded-lg bg-brand-600 px-5 font-semibold text-white hover:bg-brand-500">Xem phim đang chiếu</Link> : undefined}
          />
        ) : (
          <>
            <ul className="space-y-4">{data.items.map((o) => <TicketCard key={o.id} order={o} />)}</ul>
            <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onChange={(p) => change({ page: p > 1 ? String(p) : '' })} />
          </>
        )}
      </div>
    </div>
  );
}
