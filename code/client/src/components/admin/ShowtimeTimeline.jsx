import { axisRange, clockLabel, minutesFrom, slotValue, startingOn } from '@/lib/showtimePlan';
import { formatTime } from '@/lib/format';

// Mỗi phim một màu (viết đủ tên lớp để Tailwind nhận ra). Không dùng red-200: theme đã đổi nó thành đỏ đậm (index.css).
const COLORS = [
  'bg-rose-200 border-rose-700','bg-sky-200 border-sky-700', 'bg-amber-200 border-amber-700', 'bg-green-200 border-green-700',
  'bg-violet-200 border-violet-700', 'bg-pink-200 border-pink-700', 'bg-teal-200 border-teal-700', 'bg-orange-200 border-orange-700',
  'bg-lime-200 border-lime-700', 'bg-indigo-200 border-indigo-700',
];
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
  const movieIds = [...new Set(open.map((s) => s.movie.id))].sort();
  const colorOf = (id) => COLORS[movieIds.indexOf(id) % COLORS.length];
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
                const label = `${s.movie.title}, ${formatTime(s.startTime)}–${formatTime(s.endTime)}, ${s.bookedSeats} ghế đã đặt`;
                return (
                  <button key={s.id} type="button" onClick={() => onOpen(s)} aria-label={label} title={label}
                    className={`absolute inset-y-1 cursor-pointer overflow-hidden rounded border-l-4 px-1.5 text-left text-gray-900 hover:brightness-95 ${colorOf(s.movie.id)}`}
                    style={{ left: left(from), width: `${((to - from) / span) * 100}%` }}>
                    <span className="block truncate text-xs font-bold">{s.movie.title}</span>
                    <span className="block truncate text-[11px]">{formatTime(s.startTime)}{s.bookedSeats > 0 && <strong> · 🎟 {s.bookedSeats}</strong>}</span>
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
