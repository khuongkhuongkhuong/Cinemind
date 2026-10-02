import { isCouple } from '@/lib/seats';
import { formatMoney } from '@/lib/format';

const TYPE_LABEL = { STANDARD: 'thường', VIP: 'VIP', COUPLE: 'đôi' };
const STATUS_LABEL = { AVAILABLE: 'còn trống', HELD: 'đang được giữ', SOLD: 'đã bán', UNAVAILABLE: 'không sử dụng được' };

/** Kiểu của một ô ghế. Trạng thái luôn kèm KÝ HIỆU (không chỉ màu) để người mù màu vẫn phân biệt được. */
function seatStyle(seat, selected) {
  if (selected) return 'border-brand-500 bg-brand-600 text-white';
  switch (seat.status) {
    case 'SOLD': return 'cursor-not-allowed border-ink-700 bg-ink-600 text-ink-300';
    case 'HELD': return 'cursor-not-allowed border-warn/60 text-warn [background:repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(245,158,11,0.25)_3px,rgba(245,158,11,0.25)_6px)]';
    case 'UNAVAILABLE': return 'cursor-not-allowed border-dashed border-ink-700 text-ink-600';
    default:
      return seat.type === 'VIP'
        ? 'border-gold-400 bg-gold-400/10 text-gold-400 hover:bg-gold-400/30'
        : seat.type === 'COUPLE'
          ? 'border-pink-400 bg-pink-400/10 text-pink-300 hover:bg-pink-400/30'
          : 'border-ink-300 bg-ink-800 text-ink-100 hover:bg-ink-600';
  }
}

const symbol = (seat, selected) => (selected ? '✔' : seat.status === 'SOLD' ? '■' : seat.status === 'HELD' ? '▒' : seat.status === 'UNAVAILABLE' ? '–' : null);

function SeatButton({ seat, pair, selected, disabled, showPrice, onToggle }) {
  const sym = symbol(seat, selected);
  const label = pair ? pair.map((s) => s.label).join(' và ') : seat.label;
  const status = selected ? 'đang chọn' : STATUS_LABEL[seat.status];
  const interactive = !disabled && (seat.status === 'AVAILABLE' || selected);
  return (
    <button
      type="button"
      onClick={() => onToggle(seat)}
      disabled={!interactive}
      aria-pressed={selected}
      aria-label={`Ghế ${label}, ${TYPE_LABEL[seat.type]}${showPrice ? `, ${formatMoney(seat.price)}` : ''}${pair ? ' cả cặp' : ''}, ${status}`}
      title={`${label} · ${TYPE_LABEL[seat.type]}${showPrice ? ` · ${formatMoney(seat.price)}` : ''}${pair ? ' (cả cặp)' : ''}`}
      className={`flex h-9 shrink-0 flex-col items-center justify-center rounded-md border text-[10px] font-bold leading-none transition-colors ${pair ? 'w-[4.6rem]' : 'w-9'} ${seatStyle(seat, selected)}`}
    >
      <span>{pair ? pair.map((s) => s.number).join('-') : seat.number}</span>
      {sym && <span aria-hidden="true" className="mt-0.5 text-[9px]">{sym}</span>}
    </button>
  );
}

/** Gom hai ghế liền nhau cùng pairCode thành MỘT nút rộng (ghế đôi); ghế khác giữ nguyên. */
function layoutRow(seats) {
  const sorted = [...seats].sort((a, b) => a.number - b.number);
  const items = [];
  for (let i = 0; i < sorted.length; i++) {
    const seat = sorted[i];
    const next = sorted[i + 1];
    if (isCouple(seat) && next && next.pairCode === seat.pairCode) {
      items.push({ key: seat.pairCode, seat, pair: [seat, next] });
      i++;
    } else {
      items.push({ key: seat.id, seat, pair: null });
    }
  }
  return items;
}

export function SeatLegend() {
  const chip = 'inline-flex h-6 w-6 items-center justify-center rounded border text-[10px] font-bold';
  return (
    <ul aria-label="Chú thích" className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-300">
      <li className="flex items-center gap-2"><span className={`${chip} border-ink-300 bg-ink-800`} /> Thường</li>
      <li className="flex items-center gap-2"><span className={`${chip} border-gold-400 bg-gold-400/10`} /> VIP</li>
      <li className="flex items-center gap-2"><span className={`${chip} w-10 border-pink-400 bg-pink-400/10`} /> Đôi</li>
      <li className="flex items-center gap-2"><span className={`${chip} border-brand-500 bg-brand-600 text-white`}>✔</span> Đang chọn</li>
      <li className="flex items-center gap-2"><span className={`${chip} border-warn/60 text-warn`}>▒</span> Đang được giữ</li>
      <li className="flex items-center gap-2"><span className={`${chip} border-ink-700 bg-ink-600`}>■</span> Đã bán</li>
    </ul>
  );
}

/**
 * Sơ đồ ghế. Cuộn ngang được trên điện thoại (NFR-16). Bấm một ghế của ghế đôi sẽ chọn cả cặp (xử lý ở `onToggle`).
 * @param {{ seats: object[], rows: string[], selected: Set<string>, onToggle: (seat: object) => void, disabled?: boolean, showPrice?: boolean }} props
 * `showPrice={false}` cho trang quản trị: sơ đồ vật lý của phòng không có giá (giá thuộc về từng suất).
 */
export default function SeatMap({ seats, rows, selected, onToggle, disabled = false, showPrice = true }) {
  return (
    <div className="overflow-x-auto pb-2" tabIndex={0} role="group" aria-label="Sơ đồ ghế">
      <div className="mx-auto w-max min-w-full px-2">
        <div aria-hidden="true" className="mx-auto mb-8 mt-2 h-2 w-3/4 rounded-t-full bg-gradient-to-b from-ink-300/60 to-transparent" />
        <p aria-hidden="true" className="-mt-6 mb-6 text-center text-xs tracking-[0.4em] text-ink-300">MÀN HÌNH</p>
        <div className="space-y-2">
          {rows.map((row) => {
            const rowSeats = seats.filter((s) => s.row === row);
            return (
              <div key={row} role="row" className="flex items-center justify-center gap-1.5">
                <span aria-hidden="true" className="w-5 shrink-0 text-center text-xs font-bold text-ink-300">{row}</span>
                {layoutRow(rowSeats).map(({ key, seat, pair }) => (
                  <SeatButton key={key} seat={seat} pair={pair} disabled={disabled} showPrice={showPrice} onToggle={onToggle}
                    selected={pair ? pair.every((s) => selected.has(s.id)) : selected.has(seat.id)} />
                ))}
                <span aria-hidden="true" className="w-5 shrink-0 text-center text-xs font-bold text-ink-300">{row}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
