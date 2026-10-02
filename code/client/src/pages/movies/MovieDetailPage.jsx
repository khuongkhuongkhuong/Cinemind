import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMovie } from '@/hooks/useMovies';
import { hasCode } from '@/api/errors';
import { formatDateOnly, formatDuration } from '@/lib/format';
import { safeExternalUrl } from '@/lib/movies';
import { Poster } from '@/components/movie/MovieCard';
import ShowtimePicker from '@/components/movie/ShowtimePicker';
import AgeBadge from '@/components/ui/AgeBadge';
import ErrorState from '@/components/ui/ErrorState';
import Skeleton from '@/components/ui/Skeleton';
import { NotFoundPage } from '@/pages/common/StatusPages';

const MATURE = { T16: 16, T18: 18 };

function Info({ label, children }) {
  if (!children) return null;
  return <p className="text-sm"><span className="text-ink-300">{label}: </span><span className="text-ink-100">{children}</span></p>;
}

/** P03 — Chi tiết phim + chọn suất chiếu. */
export default function MovieDetailPage() {
  const { slug } = useParams();
  const { data: movie, isPending, isError, error, refetch } = useMovie(slug);

  useEffect(() => {
    if (movie) document.title = `${movie.title} — Cinemind`;
    return () => { document.title = 'Cinemind — Đặt vé xem phim'; };
  }, [movie]);

  if (isError && hasCode(error, 'NOT_FOUND')) return <NotFoundPage />;
  if (isError) return <ErrorState error={error} onRetry={refetch} />;
  if (isPending) {
    return (
      <div className="grid gap-6 sm:grid-cols-[14rem_1fr]" aria-busy="true">
        <Skeleton className="aspect-[2/3]" />
        <div className="space-y-3"><Skeleton className="h-9 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-24" /></div>
      </div>
    );
  }

  const trailer = safeExternalUrl(movie.trailerUrl);
  const minAge = MATURE[movie.ageRating];

  return (
    <div className="space-y-8">
      <nav aria-label="Đường dẫn" className="text-sm text-ink-300">
        <Link to="/movies" className="hover:text-brand-600">Phim</Link> <span aria-hidden="true">/</span> <span className="text-ink-100">{movie.title}</span>
      </nav>

      <section className="grid gap-6 sm:grid-cols-[14rem_1fr] lg:grid-cols-[16rem_1fr]">
        <Poster movie={movie} className="mx-auto w-48 sm:w-full" />
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-black">{movie.title}</h1>
            <AgeBadge rating={movie.ageRating} className="text-sm" />
          </div>
          <p className="text-ink-300">
            {movie.genres.map((g) => g.name).join(' · ') || 'Chưa phân loại'} · {formatDuration(movie.durationMin)} · Khởi chiếu {formatDateOnly(movie.releaseDate)}
          </p>

          {minAge && (
            <p role="note" className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-gold-400">
              Phim dành cho khán giả từ {minAge} tuổi trở lên. Nhân viên rạp có thể kiểm tra giấy tờ tại cửa vào.
            </p>
          )}

          <div className="space-y-1">
            <Info label="Đạo diễn">{movie.director}</Info>
            <Info label="Diễn viên">{movie.actors}</Info>
            <Info label="Ngôn ngữ">{movie.language}</Info>
          </div>
          <p className="max-w-3xl whitespace-pre-line leading-relaxed text-ink-100/90">{movie.description}</p>

          {trailer && (
            <a href={trailer} target="_blank" rel="noopener noreferrer"
              className="inline-flex h-11 items-center gap-2 rounded-lg border border-ink-500 px-4 text-sm font-semibold hover:bg-ink-700">
              ▶ Xem trailer
            </a>
          )}
        </div>
      </section>

      {movie.status === 'NOW_SHOWING' && <ShowtimePicker movieId={movie.id} />}
      {movie.status === 'COMING_SOON' && (
        <p className="rounded-2xl border border-ink-700 bg-ink-900 p-6 text-ink-100">
          <strong>Sắp chiếu.</strong> Phim khởi chiếu từ {formatDateOnly(movie.releaseDate)}. Lịch chiếu sẽ được cập nhật khi mở bán vé.
        </p>
      )}
      {movie.status === 'ENDED' && (
        <p className="rounded-2xl border border-ink-700 bg-ink-900 p-6 text-ink-100"><strong>Phim đã ngừng chiếu.</strong> Rất tiếc, hiện không còn suất chiếu nào.</p>
      )}
    </div>
  );
}
