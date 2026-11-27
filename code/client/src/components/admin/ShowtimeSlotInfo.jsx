import { useAdminMovies, useAdminShowtimes } from '@/hooks/useAdmin';
import { filmEndOf, findClashes, planSlot, startingOn } from '@/lib/showtimePlan';
import { formatDateOnly, formatTime, vnDateKey } from '@/lib/format';

const range = (s) => `${formatTime(s.startTime)}–${formatTime(filmEndOf(s))}`; // giờ chiếu phim

/**
 * Dưới ô giờ của form một suất: giờ phim kết thúc, giờ phòng trống lại, các suất phòng đã có trong ngày và cảnh báo trùng.
 * Chỉ BÁO TRƯỚC cho người nhập; server vẫn là nơi quyết định (SHOWTIME_OVERLAP). `excludeId`: suất đang sửa.
 */
export default function ShowtimeSlotInfo({ form, excludeId }) {
  const movies = useAdminMovies({ pageSize: 100 });
  const date = form.start.slice(0, 10);
  const day = useAdminShowtimes(
    { roomId: form.roomId, date, page: 1, pageSize: 100 },
    { enabled: Boolean(form.roomId && date), placeholderData: undefined },
  );
  const movie = movies.data?.items.find((m) => m.id === form.movieId);
  const slot = planSlot(form.start, movie?.durationMin);
  const others = form.roomId && date && day.data
    ? startingOn(day.data.items, date).filter((s) => s.status === 'OPEN' && s.id !== excludeId)
    : null;
  const clashes = slot && others ? findClashes(others, slot) : [];
  if (!slot && !others) return null;

  return (
    <div className="space-y-2 rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm">
      {slot && (
        <p role="status">
          Phim kết thúc <strong>{formatTime(slot.filmEnd)}</strong> · phòng trống lại lúc <strong>{formatTime(slot.roomFree)}</strong>
          {vnDateKey(slot.roomFree) !== date && ' (hôm sau)'}
        </p>
      )}
      {others && (others.length === 0 ? <p className="text-ink-300">Phòng chưa có suất nào ngày {formatDateOnly(date)}.</p> : (
        <div>
          <p className="mb-1 text-ink-300">Phòng đã có {others.length} suất ngày {formatDateOnly(date)} (giờ chiếu phim, sau mỗi suất dọn 15 phút):</p>
          <ul aria-label="Suất đã có của phòng" className="flex max-h-28 flex-wrap gap-1.5 overflow-auto">
            {others.map((s) => (
              <li key={s.id} title={`${s.movie.title} (dọn phòng đến ${formatTime(s.endTime)})`}
                className={`rounded border px-2 py-0.5 text-xs ${clashes.includes(s) ? 'border-bad bg-bad/20 font-bold' : 'border-ink-600 bg-ink-900'}`}>
                {range(s)}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {clashes.length > 0 && (
        <p role="alert" className="font-semibold text-red-300">
          Trùng với {clashes.map((s) => `"${s.movie.title}" ${range(s)} (dọn đến ${formatTime(s.endTime)})`).join(', ')}. Hãy chọn giờ khác.
        </p>
      )}
    </div>
  );
}
