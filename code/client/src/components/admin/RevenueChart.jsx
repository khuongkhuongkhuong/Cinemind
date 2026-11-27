import { useState } from 'react';
import { compactMoney, labelIndexes, niceTicks, shortDate } from '@/lib/revenueChart';
import { formatDateOnly, formatMoney } from '@/lib/format';
import Button from '@/components/ui/Button';

const PLOT_H = 'h-60';

/**
 * Doanh thu theo ngày: một chuỗi số liệu nên một màu, không cần chú giải. Trục tiền từ 0, đường lưới mờ, nhãn ngày cách đều,
 * chỉ ghi số trên cột cao nhất (ảnh chụp vẫn đọc được), rê chuột hoặc Tab vào cột để xem chi tiết. Có chế độ bảng.
 */
export default function RevenueChart({ rows }) {
  const [asTable, setAsTable] = useState(false);
  const [active, setActive] = useState(null);
  const max = Math.max(0, ...rows.map((r) => r.revenue));
  const ticks = niceTicks(max);
  const top = ticks.at(-1);
  const labelled = labelIndexes(rows.length);
  const peak = rows.findIndex((r) => r.revenue === max);
  const percent = (value) => `${(value / top) * 100}%`;
  const detail = (r) => `${formatDateOnly(r.key)}: ${formatMoney(r.revenue)} · ${r.ticketCount} vé · ${r.orderCount} đơn`;

  return (
    <section aria-labelledby="chart-title" className="rounded-xl border border-ink-700 bg-ink-900 p-4">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h2 id="chart-title" className="font-semibold">Doanh thu theo ngày</h2>
        <Button size="sm" variant="ghost" onClick={() => setAsTable((v) => !v)}>{asTable ? 'Xem biểu đồ' : 'Xem dạng bảng'}</Button>
      </div>

      {asTable ? (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Doanh thu từng ngày</caption>
            <thead className="sticky top-0 bg-ink-900 text-xs uppercase text-ink-300">
              <tr><th className="py-2">Ngày</th><th className="py-2 text-right">Doanh thu</th><th className="py-2 text-right">Vé</th><th className="py-2 text-right">Đơn</th></tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-ink-700">
                  <td className="py-1.5">{formatDateOnly(r.key)}</td><td className="py-1.5 text-right">{formatMoney(r.revenue)}</td>
                  <td className="py-1.5 text-right">{r.ticketCount}</td><td className="py-1.5 text-right">{r.orderCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div role="group" aria-label={`Biểu đồ doanh thu ${rows.length} ngày`} className="flex gap-2">
          <div aria-hidden="true" className={`relative w-12 shrink-0 text-right text-xs text-ink-300 ${PLOT_H}`}>
            {ticks.map((t) => <span key={t} className="absolute right-0 translate-y-1/2" style={{ bottom: percent(t) }}>{compactMoney(t)}</span>)}
          </div>
          <div className="min-w-0 flex-1">
            <div className={`relative ${PLOT_H}`}>
              {ticks.map((t) => <div key={t} aria-hidden="true" className={`absolute inset-x-0 border-t ${t === 0 ? 'border-ink-500' : 'border-ink-700'}`} style={{ bottom: percent(t) }} />)}
              <div className="absolute inset-0 flex items-end gap-0.5" onMouseLeave={() => setActive(null)}>
                {rows.map((r, i) => (
                  <div key={r.key} tabIndex={0} role="img" aria-label={detail(r)}
                    onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}
                    className={`relative flex h-full flex-1 items-end justify-center ${active === i ? 'bg-ink-800' : ''}`}>
                    <div className="relative w-full max-w-6 rounded-t bg-brand-500" style={{ height: percent(r.revenue), minHeight: r.revenue > 0 ? 2 : 0 }}>
                      {i === peak && max > 0 && (
                        <span aria-hidden="true" className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs font-semibold text-ink-100">{compactMoney(r.revenue)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {active !== null && rows[active] && (
                <div role="tooltip" className="pointer-events-none absolute top-0 z-10 whitespace-nowrap rounded-lg border border-ink-500 bg-ink-900 px-3 py-2 text-xs shadow-lg"
                  style={active < rows.length / 2 ? { left: percentOf(active + 1, rows.length) } : { right: percentOf(rows.length - active, rows.length) }}>
                  <p className="font-semibold">{formatDateOnly(rows[active].key)}</p>
                  <p>{formatMoney(rows[active].revenue)}</p>
                  <p className="text-ink-300">{rows[active].ticketCount} vé · {rows[active].orderCount} đơn</p>
                </div>
              )}
            </div>
            <div aria-hidden="true" className="mt-1 flex h-4 gap-0.5 text-xs text-ink-300">
              {rows.map((r, i) => (
                <div key={r.key} className="relative flex-1">
                  {labelled.has(i) && <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap">{shortDate(r.key)}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

const percentOf = (part, whole) => `${(part / whole) * 100}%`;
