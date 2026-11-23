import { Link } from 'react-router-dom';
import { formatDateTime, formatMoney } from '@/lib/format';
import { safeExternalUrl } from '@/lib/movies';

/** Thẻ đơn hàng trong khung chat: dữ liệu `order` do SERVER trả (cấu trúc `Order` chung, hợp đồng API mục 3.4). */
export default function OrderCard({ order, paymentUrl }) {
  const gateway = safeExternalUrl(paymentUrl);
  const { showtime } = order;
  return (
    <article aria-label={`Đơn ${order.code}`} className="mt-2 rounded-lg border border-ink-500 bg-ink-900 p-3 text-sm">
      <p className="font-bold text-ink-100">{showtime.movie.title}</p>
      <p className="text-ink-300">{showtime.cinema.name} · {showtime.room.name} · {formatDateTime(showtime.startTime)}</p>
      <p className="mt-1 text-ink-100">Ghế: {order.seats.map((s) => s.label).join(', ')}</p>
      {order.combos.length > 0 && <p className="text-ink-100">Combo: {order.combos.map((c) => `${c.name} ×${c.quantity}`).join(', ')}</p>}
      <p className="mt-1 font-bold text-brand-600">Tổng: {formatMoney(order.total)}</p>
      <p className="text-xs text-ink-300">Mã đơn {order.code}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Link to={`/booking/orders/${order.id}`} className="rounded bg-brand-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-brand-500">
          Xem đơn và thanh toán
        </Link>
        {gateway && (
          <a href={gateway} className="rounded border border-ink-500 px-3 py-1.5 text-sm font-bold text-ink-100 hover:bg-ink-700">
            Thanh toán ngay
          </a>
        )}
      </div>
    </article>
  );
}
