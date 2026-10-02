import { useCombos } from '@/hooks/useBooking';
import { formatMoney } from '@/lib/format';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import Skeleton from '@/components/ui/Skeleton';

export const MAX_COMBO_QTY = 10; // BR-20

/** Chọn combo bắp nước: `quantities` là { [comboId]: số lượng } do trang cha quản lý. Giá hiển thị là giá niêm yết của server. */
export default function ComboPicker({ quantities, onChange, disabled }) {
  const { data, isPending, isError, error, refetch } = useCombos();

  if (isError) return <ErrorState error={error} title="Không tải được danh sách combo" onRetry={refetch} />;
  if (isPending) return <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>;
  if (!data.length) return <EmptyState title="Chưa có combo" description="Hiện chưa có combo nào được bán." />;

  const set = (id, qty) => onChange({ ...quantities, [id]: Math.max(0, Math.min(MAX_COMBO_QTY, qty)) });

  return (
    <ul className="space-y-3">
      {data.map((c) => {
        const qty = quantities[c.id] ?? 0;
        return (
          <li key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-ink-700 bg-ink-800 p-3">
            <div className="min-w-0">
              <p className="font-semibold">{c.name}</p>
              {c.description && <p className="truncate text-xs text-ink-300">{c.description}</p>}
              <p className="mt-0.5 text-sm text-gold-400">{formatMoney(c.price)}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2" role="group" aria-label={`Số lượng ${c.name}`}>
              <button type="button" aria-label={`Giảm ${c.name}`} disabled={disabled || qty <= 0} onClick={() => set(c.id, qty - 1)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-ink-500 text-lg hover:bg-ink-700 disabled:opacity-40">−</button>
              <span aria-live="polite" className="w-6 text-center font-bold">{qty}</span>
              <button type="button" aria-label={`Tăng ${c.name}`} disabled={disabled || qty >= MAX_COMBO_QTY} onClick={() => set(c.id, qty + 1)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-ink-500 text-lg hover:bg-ink-700 disabled:opacity-40">+</button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
