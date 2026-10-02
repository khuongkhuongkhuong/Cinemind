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

      <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-brand-700 via-ink-800 to-ink-900 px-6 py-12 sm:px-12">
        <h1 className="max-w-xl text-3xl font-black leading-tight sm:text-5xl">Chọn phim. Chọn ghế. <span className="text-gold-400">Vào rạp.</span></h1>
        <p className="mt-3 max-w-lg text-ink-100/80">Đặt vé xem phim trong vài bước: ghế được giữ cho bạn 10 phút, thanh toán an toàn qua VNPay.</p>
        <Link to="/movies?status=NOW_SHOWING" className="mt-6 inline-flex h-12 items-center rounded-lg bg-white px-6 font-bold text-ink-950 hover:bg-ink-100">
          Xem phim đang chiếu
        </Link>
      </section>

      <section aria-labelledby="home-movies">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="home-movies" className="sr-only">Phim</h2>
          <div role="tablist" aria-label="Loại phim" className="flex gap-2">
            {TABS.map((t) => (
              <button
                key={t.status} role="tab" type="button" aria-selected={status === t.status} onClick={() => setStatus(t.status)}
                className={`h-10 rounded-lg px-4 text-sm font-semibold transition-colors ${status === t.status ? 'bg-brand-600 text-white' : 'bg-ink-800 text-ink-300 hover:text-white'}`}
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
