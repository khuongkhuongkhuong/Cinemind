import { Link } from 'react-router-dom';
import AgeBadge from '@/components/ui/AgeBadge';
import { formatDuration } from '@/lib/format';

/** Ảnh poster; thiếu ảnh hoặc ảnh lỗi thì hiện khối màu có chữ cái đầu của tên phim. */
export function Poster({ movie, className = '' }) {
  return (
    <div className={`relative aspect-[2/3] overflow-hidden rounded bg-gradient-to-br from-ink-600 to-ink-800 ${className}`}>
      <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center text-6xl font-black text-ink-500">
        {movie.title.trim().charAt(0).toUpperCase()}
      </div>
      {movie.posterUrl && (
        <img
          src={movie.posterUrl} alt={`Poster phim ${movie.title}`} loading="lazy"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </div>
  );
}

export default function MovieCard({ movie }) {
  return (
    <article className="group flex flex-col gap-2">
      <Link to={`/movies/${movie.slug}`} className="relative block rounded shadow-md transition-transform group-hover:-translate-y-1" aria-label={`${movie.title} — xem chi tiết`}>
        <Poster movie={movie} />
        <AgeBadge rating={movie.ageRating} className="absolute left-2 top-2 backdrop-blur" />
      </Link>
      <div className="min-w-0">
        <h3 className="truncate font-bold text-ink-100" title={movie.title}>
          <Link to={`/movies/${movie.slug}`} className="hover:text-brand-400">{movie.title}</Link>
        </h3>
        <p className="truncate text-xs text-ink-300">
          {movie.genres.map((g) => g.name).join(', ') || 'Chưa phân loại'} · {formatDuration(movie.durationMin)}
        </p>
      </div>
      {movie.status === 'NOW_SHOWING' && (
        <Link
          to={`/movies/${movie.slug}`}
          className="inline-flex h-9 items-center justify-center rounded bg-brand-600 text-sm font-bold uppercase tracking-wide text-white hover:bg-brand-500"
        >
          Mua vé
        </Link>
      )}
    </article>
  );
}

export function MovieCardSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      <div className="aspect-[2/3] animate-pulse rounded-xl bg-ink-700" />
      <div className="h-4 w-3/4 animate-pulse rounded bg-ink-700" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-ink-700" />
    </div>
  );
}
