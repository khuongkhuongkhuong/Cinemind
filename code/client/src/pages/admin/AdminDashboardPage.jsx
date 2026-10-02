import { useMemo, useState } from 'react';
import { useRevenue } from '@/hooks/useAdmin';
import { barHeights, sumRevenue } from '@/lib/adminCatalogForms';
import { formatDateOnly, formatMoney, vnDateKey } from '@/lib/format';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import Skeleton from '@/components/ui/Skeleton';
import SelectField from '@/components/ui/SelectField';
import TextField from '@/components/ui/TextField';

const GROUPS = { day: 'Theo ngày', movie: 'Theo phim', cinema: 'Theo rạp' };
const daysBefore = (key, n) => new Date(Date.parse(key) - n * 86_400_000).toISOString().slice(0, 10);

const Card = ({ label, value }) => (
  <div className="rounded-xl border border-ink-700 bg-ink-900 p-4">
    <p className="text-sm text-ink-300">{label}</p>
    <p className="mt-1 text-2xl font-bold">{value}</p>
  </div>
);

/** Biểu đồ cột theo ngày, vẽ bằng CSS (không cần thư viện). Có `title` + bảng tóm tắt cho trình đọc màn hình. */
function DayChart({ rows }) {
  const heights = barHeights(rows);
  return (
    <div role="img" aria-label={`Biểu đồ doanh thu ${rows.length} ngày`} className="flex h-56 items-end gap-0.5 overflow-x-auto rounded-xl border border-ink-700 bg-ink-900 p-4">
      {rows.map((r, i) => (
        <div key={r.key} title={`${formatDateOnly(r.key)}: ${formatMoney(r.revenue)} · ${r.ticketCount} vé`} className="flex h-full min-w-2 flex-1 items-end">
          <div className="w-full rounded-t bg-brand-500 hover:bg-brand-400" style={{ height: `${heights[i]}%` }} />
        </div>
      ))}
    </div>
  );
}

function RankList({ rows }) {
  const heights = barHeights(rows);
  return (
    <ol className="space-y-2">
      {rows.map((r, i) => (
        <li key={r.key} className="rounded-xl border border-ink-700 bg-ink-900 p-3">
          <div className="mb-1 flex justify-between gap-3 text-sm"><span className="truncate font-semibold">{i + 1}. {r.label}</span><span>{formatMoney(r.revenue)}</span></div>
          <div className="h-2 rounded bg-ink-700"><div className="h-2 rounded bg-brand-500" style={{ width: `${heights[i]}%` }} /></div>
          <p className="mt-1 text-xs text-ink-300">{r.ticketCount} vé · {r.orderCount} đơn</p>
        </li>
      ))}
    </ol>
  );
}

export default function AdminDashboardPage() {
  const today = useMemo(() => vnDateKey(), []);
  const [from, setFrom] = useState(daysBefore(today, 29));
  const [to, setTo] = useState(today);
  const [groupBy, setGroupBy] = useState('day');
  const q = useRevenue({ from, to, groupBy });
  const rows = q.data ?? [];
  const total = sumRevenue(rows);

  return (
    <section>
      <h1 className="mb-1 text-2xl font-bold">Tổng quan doanh thu</h1>
      <p className="mb-6 text-sm text-ink-300">Chỉ tính đơn đã thanh toán (PAID); đơn hoàn tiền, hủy, hết hạn không tính. Ngày theo giờ Việt Nam.</p>
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <TextField label="Từ ngày" type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="w-full sm:w-44" />
        <TextField label="Đến ngày" type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className="w-full sm:w-44" />
        <SelectField label="Nhóm" value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className="w-full sm:w-44">
          {Object.entries(GROUPS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </SelectField>
      </div>
      {q.isPending ? <Skeleton className="h-72" /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card label="Doanh thu" value={formatMoney(total.revenue)} />
            <Card label="Số vé (ghế)" value={total.ticketCount} />
            <Card label="Số đơn" value={total.orderCount} />
          </div>
          {total.orderCount === 0 ? <EmptyState title="Chưa có doanh thu trong khoảng này" description="Thử mở rộng khoảng ngày." />
            : groupBy === 'day' ? <DayChart rows={rows} /> : <RankList rows={rows} />}
        </div>
      )}
    </section>
  );
}
