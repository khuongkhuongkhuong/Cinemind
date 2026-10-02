import { formatDateTime, formatMoney } from '@/lib/format';
import { audioLabel, formatLabel } from '@/lib/movies';
import AgeBadge from '@/components/ui/AgeBadge';

/**
 * Tóm tắt đơn. MỌI con số lấy thẳng từ server (seatTotal, comboTotal, discount, total) — giao diện không tự cộng trừ,
 * để số hiển thị luôn đúng với số sẽ thu (BR-15).
 */
export default function OrderSummary({ order }) {
  const { showtime } = order;
  return (
    <div className="space-y-4 text-sm">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-bold">{showtime.movie.title}</h3>
          <AgeBadge rating={showtime.movie.ageRating} />
        </div>
        <p className="mt-1 text-ink-300">{formatDateTime(showtime.startTime)} · {formatLabel(showtime.format)} {audioLabel(showtime.audio)}</p>
        <p className="text-ink-300">{showtime.cinema.name} · {showtime.room.name}</p>
      </div>

      <dl className="space-y-1.5 border-t border-ink-700 pt-3">
        {order.seats.map((s) => (
          <div key={s.seatId} className="flex justify-between gap-3">
            <dt>Ghế {s.label} <span className="text-ink-300">({{ STANDARD: 'Thường', VIP: 'VIP', COUPLE: 'Đôi' }[s.type]})</span></dt>
            <dd>{formatMoney(s.price)}</dd>
          </div>
        ))}
        {order.combos.map((c) => (
          <div key={c.comboId} className="flex justify-between gap-3">
            <dt>{c.name} <span className="text-ink-300">× {c.quantity}</span></dt>
            <dd>{formatMoney(c.subtotal)}</dd>
          </div>
        ))}
        {order.discount > 0 && (
          <div className="flex justify-between gap-3 text-ok">
            <dt>Giảm giá{order.promotion ? ` (${order.promotion.code})` : ''}</dt>
            <dd>-{formatMoney(order.discount)}</dd>
          </div>
        )}
      </dl>

      <div className="flex items-baseline justify-between border-t border-ink-600 pt-3">
        <span className="font-semibold">Tổng cộng</span>
        <span data-testid="order-total" className="text-2xl font-black text-gold-400">{formatMoney(order.total)}</span>
      </div>
    </div>
  );
}
