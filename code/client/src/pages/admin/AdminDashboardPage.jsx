import { useMemo, useState } from 'react';
import { useRevenue } from '@/hooks/useAdmin';
import { barHeights, sumRevenue } from '@/lib/adminCatalogForms';
import { change, daysBefore, previousRange } from '@/lib/revenueChart';
import { formatDateOnly, formatMoney, vnDateKey } from '@/lib/format';
import RevenueChart from '@/components/admin/RevenueChart';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import Skeleton from '@/components/ui/Skeleton';
import TextField from '@/components/ui/TextField';

const PRESETS = [7, 14, 30];
const TOP = 5;
const count = (n) => new Intl.NumberFormat('vi-VN').format(n);
const average = (t) => (t.orderCount ? Math.round(t.revenue / t.orderCount) : 0);

const DELTA = {
  up: { arrow: '▲', word: 'tăng', tone: 'text-green-300' },
  down: { arrow: '▼', word: 'giảm', tone: 'text-red-300' },
  flat: { arrow: '●', word: 'không đổi', tone: 'text-ink-300' },
};

/** Thẻ số liệu: giá trị và mức tăng / giảm so với kỳ liền trước (có mũi tên và chữ, không chỉ dựa vào màu). */
function StatTile({ label, value, delta, comparing }) {
  const d = delta && DELTA[delta.direction];
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900 p-4">
      <p className="text-sm text-ink-300">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {comparing && (
        <p className="mt-1 text-xs text-ink-300">
          {d ? <><span className={`font-semibold ${d.tone}`}><span aria-hidden="true">{d.arrow} </span>{d.word}{delta.direction !== 'flat' && ` ${delta.percent}%`}</span> so với kỳ trước</>
            : 'Kỳ trước chưa có doanh thu'}
        </p>
      )}
    </div>
  );
}

/** Bảng xếp hạng theo doanh thu (phim / rạp) kèm thanh so sánh. Dài hơn TOP dòng thì có nút "Xem tất cả". */
function Ranking({ title, query }) {
  const [all, setAll] = useState(false);
  const rows = query.data ?? [];
  const widths = barHeights(rows);
  const total = sumRevenue(rows).revenue;
  return (
    <section aria-label={title} className="rounded-xl border border-ink-700 bg-ink-900 p-4">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {query.isPending ? <Skeleton className="h-48" /> : query.error ? <ErrorState error={query.error} onRetry={query.refetch} />
        : rows.length === 0 ? <p className="text-sm text-ink-300">Chưa có doanh thu.</p> : (
          <ol className="space-y-3">
            {(all ? rows : rows.slice(0, TOP)).map((r, i) => (
              <li key={r.key}>
                <div className="flex justify-between gap-3 text-sm">
                  <span className="truncate font-medium" title={r.label}>{i + 1}. {r.label}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{formatMoney(r.revenue)}</span>
                </div>
                <div className="mt-1 h-2 rounded bg-ink-700"><div className="h-2 rounded bg-brand-500" style={{ width: `${widths[i]}%` }} /></div>
                <p className="mt-0.5 text-xs text-ink-300">{r.ticketCount} vé · {r.orderCount} đơn · {Math.round((r.revenue / total) * 100)}% doanh thu</p>
              </li>
            ))}
          </ol>
        )}
      {rows.length > TOP && <Button size="sm" variant="ghost" className="mt-3" onClick={() => setAll((v) => !v)}>{all ? 'Thu gọn' : `Xem tất cả (${rows.length})`}</Button>}
    </section>
  );
}

/** A01 — Tổng quan doanh thu (FR-37): thẻ số liệu, biểu đồ theo ngày, xếp hạng phim và rạp trong cùng một khoảng ngày. */
export default function AdminDashboardPage() {
  const today = useMemo(() => vnDateKey(), []);
  const [from, setFrom] = useState(() => daysBefore(today, 29));
  const [to, setTo] = useState(today);
  const before = previousRange(from, to);

  const days = useRevenue({ from, to, groupBy: 'day' });
  const previous = useRevenue({ ...before, groupBy: 'day' });
  const movies = useRevenue({ from, to, groupBy: 'movie' });
  const cinemas = useRevenue({ from, to, groupBy: 'cinema' });

  const rows = days.data ?? [];
  const total = sumRevenue(rows);
  const past = sumRevenue(previous.data ?? []);
  const comparing = Boolean(previous.data) && !previous.isPlaceholderData;
  const tiles = [
    ['Doanh thu', formatMoney(total.revenue), change(total.revenue, past.revenue)],
    ['Số vé (ghế)', count(total.ticketCount), change(total.ticketCount, past.ticketCount)],
    ['Số đơn', count(total.orderCount), change(total.orderCount, past.orderCount)],
    ['Trung bình mỗi đơn', formatMoney(average(total)), change(average(total), average(past))],
  ];

  return (
    <section>
      <h1 className="mb-1 text-2xl font-bold">Tổng quan doanh thu</h1>
      <p className="mb-6 text-sm text-ink-300">Chỉ tính đơn đã thanh toán (PAID); đơn hoàn tiền, hủy, hết hạn không tính. Ngày theo giờ Việt Nam.</p>

      <div className="mb-6 flex flex-wrap items-end gap-3">
        <TextField label="Từ ngày" type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="w-full sm:w-44" />
        <TextField label="Đến ngày" type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className="w-full sm:w-44" />
        <div role="group" aria-label="Chọn nhanh khoảng ngày" className="flex gap-2">
          {PRESETS.map((n) => {
            const selected = to === today && from === daysBefore(today, n - 1);
            return (
              <Button key={n} variant={selected ? 'primary' : 'secondary'} aria-pressed={selected}
                onClick={() => { setFrom(daysBefore(today, n - 1)); setTo(today); }}>{n} ngày</Button>
            );
          })}
        </div>
      </div>

      {days.isPending ? <Skeleton className="h-72" /> : days.error ? <ErrorState error={days.error} onRetry={days.refetch} /> : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {tiles.map(([label, value, delta]) => <StatTile key={label} label={label} value={value} delta={delta} comparing={comparing} />)}
          </div>
          <p className="text-xs text-ink-300">Kỳ trước: {formatDateOnly(before.from)} – {formatDateOnly(before.to)}.</p>
          {total.orderCount === 0 ? <EmptyState title="Chưa có doanh thu trong khoảng này" description="Thử mở rộng khoảng ngày." /> : (
            <>
              <RevenueChart rows={rows} />
              <div className="grid gap-4 lg:grid-cols-2">
                <Ranking title="Phim doanh thu cao nhất" query={movies} />
                <Ranking title="Doanh thu theo rạp" query={cinemas} />
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
