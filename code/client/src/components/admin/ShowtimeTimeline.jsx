import { axisRange, CLEANING_MIN, clockLabel, filmEndOf, minutesFrom, moviesByShowCount, slotValue, startingOn } from '@/lib/showtimePlan';
import { formatTime } from '@/lib/format';

// Mỗi phim một màu (viết đủ tên lớp để Tailwind nhận ra): 8 màu nhạt rồi 8 màu đậm hơn.
// Không dùng red-200 / red-300 / green-300 / amber-300 / pink-300 / pink-400: theme đã đổi chúng thành màu đậm (index.css).
export const COLORS = [
  'bg-sky-200 border-sky-700', 'bg-amber-200 border-amber-700', 'bg-green-200 border-green-700', 'bg-violet-200 border-violet-700',
  'bg-rose-200 border-rose-700', 'bg-teal-200 border-teal-700', 'bg-orange-200 border-orange-700', 'bg-slate-200 border-slate-700',
  'bg-lime-400 border-lime-800', 'bg-fuchsia-300 border-fuchsia-800', 'bg-sky-400 border-sky-900', 'bg-yellow-400 border-yellow-800',
  'bg-rose-400 border-rose-900', 'bg-cyan-300 border-cyan-800', 'bg-orange-400 border-orange-900', 'bg-stone-400 border-stone-800',
];
export const OTHER_COLOR = 'bg-white border-gray-500'; // phim ngoài 16 phim nhiều suất nhất
const STRIPES = 'repeating-linear-gradient(45deg, #6b7280 0 2px, #e5e7eb 2px 6px)'; // phần dọn phòng
const PX_PER_MIN = 1.6; // một giờ rộng 96px: đủ đọc tên phim, cuộn ngang được

/**
 * Lịch một rạp trong một ngày: mỗi phòng một hàng, mỗi suất một khối dài theo thời lượng (gồm dọn phòng).
 * Bấm chỗ trống -> `onAdd(roomId, giá trị datetime-local)`; nút "+" cho người dùng bàn phím -> `onAdd(roomId, '')`; bấm khối -> `onOpen(suất)`.
 */
export default function ShowtimeTimeline({ rooms, showtimes, date, onAdd, onOpen }) {
  const open = startingOn(showtimes, date).filter((s) => s.status === 'OPEN');
  const range = axisRange(open, date);
  const span = range.end - range.start;
  const width = span * PX_PER_MIN;
  const movieIds = moviesByShowCount(open);
  const colorOf = (id) => COLORS[movieIds.indexOf(id)] ?? OTHER_COLOR;
  const hours = Array.from({ length: span / 60 }, (_, i) => range.start + i * 60);
  const left = (min) => `${((min - range.start) / span) * 100}%`;

  const clickTrack = (roomId) => (e) => {
    if (e.target !== e.currentTarget) return; // bấm vào khối suất thì không tính là chỗ trống
    const box = e.currentTarget.getBoundingClientRect();
    onAdd(roomId, slotValue(box.width ? (e.clientX - box.left) / box.width : 0, range, date));
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-ink-700 bg-ink-900">
      <div style={{ width: width + 120 }}>
        <div className="flex border-b border-ink-700 text-xs text-ink-300">
          <div className="sticky left-0 z-10 w-[120px] shrink-0 bg-ink-900 px-3 py-2 font-semibold">Phòng</div>
          <div className="relative h-8 flex-1" aria-hidden="true">
            {hours.map((h) => <span key={h} className="absolute top-2 border-l border-ink-600 pl-1" style={{ left: left(h) }}>{clockLabel(h)}</span>)}
          </div>
        </div>
        {rooms.map((room) => (
          <div key={room.id} className="flex border-b border-ink-700 last:border-b-0">
            <div className="sticky left-0 z-10 flex w-[120px] shrink-0 items-center justify-between gap-1 border-r border-ink-700 bg-ink-900 px-3">
              <span className="text-sm font-semibold">{room.name}</span>
              <button type="button" onClick={() => onAdd(room.id, '')} aria-label={`Thêm suất cho ${room.name}`}
                className="flex h-6 w-6 items-center justify-center rounded border border-ink-500 text-sm hover:bg-ink-700">+</button>
            </div>
            <div role="group" aria-label={`Lịch ${room.name}`} onClick={clickTrack(room.id)} title="Bấm chỗ trống để thêm suất"
              className="relative h-14 flex-1 cursor-copy bg-ink-950">
              {open.filter((s) => s.room.id === room.id).map((s) => {
                const from = minutesFrom(s.startTime, date);
                const to = minutesFrom(s.endTime, date);
                const filmTime = `${formatTime(s.startTime)}–${formatTime(filmEndOf(s))}`;
                const label = `${s.movie.title}, ${filmTime}, dọn phòng đến ${formatTime(s.endTime)}, ${s.bookedSeats} ghế đã đặt`;
                return (
                  <button key={s.id} type="button" onClick={() => onOpen(s)} aria-label={label} title={label}
                    className={`absolute inset-y-1 cursor-pointer overflow-hidden rounded border-l-4 pl-1.5 pr-7 text-left text-gray-900 hover:brightness-95 ${colorOf(s.movie.id)}`}
                    style={{ left: left(from), width: `${((to - from) / span) * 100}%` }}>
                    <span className="block truncate text-xs font-bold">{s.movie.title}</span>
                    <span className="block truncate text-[11px]">{filmTime}{s.bookedSeats > 0 && <strong> · 🎟 {s.bookedSeats}</strong>}</span>
                    <span data-testid="cleaning" aria-hidden="true" className="absolute inset-y-0 right-0"
                      style={{ width: `${(CLEANING_MIN / (to - from)) * 100}%`, backgroundImage: STRIPES }} />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
