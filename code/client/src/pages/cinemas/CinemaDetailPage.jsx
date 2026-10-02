import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { hasCode } from '@/api/errors';
import { useCinemaShowtimes } from '@/hooks/useMovies';
import { nextDays } from '@/lib/format';
import { showGroupLabel } from '@/lib/movies';
import TimeChip from '@/components/movie/TimeChip';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import Skeleton from '@/components/ui/Skeleton';
import { NotFoundPage } from '@/pages/common/StatusPages';

/** P04 — Lịch chiếu của một rạp theo ngày, nhóm theo phim → định dạng → giờ. */
export default function CinemaDetailPage() {
  const { id } = useParams();
  const days = useMemo(() => nextDays(7), []);
  const [date, setDate] = useState(days[0].key);
  const q = useCinemaShowtimes({ cinemaId: id, date });

  if (q.error && hasCode(q.error, 'NOT_FOUND')) return <NotFoundPage />; // rạp không có hoặc đã tắt

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link to="/cinemas" className="text-sm text-ink-300 hover:text-brand-600">← Tất cả rạp</Link>
      <h1 className="mt-2 text-3xl font-extrabold">{q.data?.cinema.name ?? 'Lịch chiếu theo rạp'}</h1>
      {q.data && <p className="text-ink-300">{q.data.cinema.address}</p>}

      <div role="tablist" aria-label="Chọn ngày" className="mt-6 flex gap-2 overflow-x-auto pb-2">
        {days.map((d, i) => (
          <button key={d.key} role="tab" type="button" aria-selected={date === d.key} onClick={() => setDate(d.key)}
            className={`flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl border text-sm transition-colors ${date === d.key ? 'border-brand-500 bg-brand-600 text-white' : 'border-ink-600 bg-ink-800 text-ink-100 hover:border-ink-300'}`}>
            <span className="text-xs opacity-80">{i === 0 ? 'Hôm nay' : d.weekday}</span>
            <span className="font-bold">{d.label}</span>
          </button>
        ))}
      </div>

      <div className="mt-6" aria-live="polite">
        {q.isError ? <ErrorState error={q.error} title="Không tải được lịch chiếu" onRetry={q.refetch} />
          : q.isPending ? <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-24" />)}</div>
            : q.data.movies.length === 0 ? <EmptyState title="Chưa có suất chiếu" description="Rạp không có suất nào trong ngày này. Hãy thử ngày khác." />
              : (
                <div className="space-y-6">
                  {q.data.movies.map(({ movie, groups }) => (
                    <section key={movie.id} className="rounded-2xl border border-ink-700 bg-ink-900 p-4">
                      <h2 className="text-lg font-bold"><Link to={`/movies/${movie.slug}`} className="hover:text-brand-400">{movie.title}</Link></h2>
                      <p className="text-xs text-ink-300">{movie.durationMin} phút · {movie.ageRating}</p>
                      <div className="mt-3 space-y-3">
                        {groups.map((g) => (
                          <div key={`${g.format}-${g.audio}`} className="flex flex-wrap items-center gap-3">
                            <span className="w-28 shrink-0 text-sm text-ink-300">{showGroupLabel(g)}</span>
                            <div className="flex flex-wrap gap-2">{g.showtimes.map((t) => <TimeChip key={t.id} showtime={t} />)}</div>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}
      </div>
    </div>
  );
}
