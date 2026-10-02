import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMovies } from '@/hooks/useMovies';
import MovieCard, { MovieCardSkeleton } from '@/components/movie/MovieCard';
import BannerSlider from '@/components/movie/BannerSlider';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';

const TABS = [
  { status: 'NOW_SHOWING', label: 'Đang chiếu' },
  { status: 'COMING_SOON', label: 'Sắp chiếu' },
];

export default function HomePage() {
  const [status, setStatus] = useState('NOW_SHOWING');
  const { data, isPending, isError, error, refetch } = useMovies({ status, pageSize: 10 });

  return (
    <div className="space-y-10">
      <BannerSlider />

      <section aria-labelledby="home-movies">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="home-movies" className="sr-only">Phim</h2>
          <div role="tablist" aria-label="Loại phim" className="flex gap-2">
            {TABS.map((t) => (
              <button
                key={t.status} role="tab" type="button" aria-selected={status === t.status} onClick={() => setStatus(t.status)}
                className={`h-11 border-b-4 px-4 text-sm font-bold uppercase tracking-wide transition-colors ${status === t.status ? 'border-brand-600 text-ink-100' : 'border-transparent text-ink-300 hover:text-brand-600'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <Link to={`/movies?status=${status}`} className="text-sm font-medium text-brand-400 hover:text-brand-500">Xem tất cả →</Link>
        </div>

        {isError ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : isPending ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 5 }, (_, i) => <MovieCardSkeleton key={i} />)}
          </div>
        ) : data.items.length === 0 ? (
          <EmptyState title="Chưa có phim" description="Hiện chưa có phim nào trong nhóm này." />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {data.items.map((m) => <MovieCard key={m.id} movie={m} />)}
          </div>
        )}
      </section>
    </div>
  );
}
