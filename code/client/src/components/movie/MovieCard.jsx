import { Link } from 'react-router-dom';
import TrailerButton from '@/components/movie/TrailerButton';
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

// Lớp phủ: thiết bị có chuột thì ẩn, hiện khi rê chuột hoặc khi bàn phím đang ở trong thẻ; thiết bị cảm ứng (không rê chuột được) thì luôn hiện.
const REVEAL = '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:transition-opacity [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100';

/**
 * Thẻ phim. Có chuột: rê vào poster hiện nút phát trailer, tên phim, "Xem chi tiết", "Mua vé" đè lên poster.
 * Cảm ứng: nút trailer nằm trên poster, hai nút hành động nằm dưới tên phim.
 * Dùng grid để cùng một bộ nút đổi chỗ giữa hai kiểu mà không phải vẽ hai lần.
 */
export default function MovieCard({ movie }) {
  const detail = `/movies/${movie.slug}`;
  return (
    <article className="group grid grid-cols-[minmax(0,1fr)] content-start gap-y-2">
      <Link to={detail} className="relative col-start-1 row-start-1 block rounded shadow-md" aria-label={`${movie.title} — xem chi tiết`}>
        <Poster movie={movie} />
        <AgeBadge rating={movie.ageRating} className="absolute left-2 top-2 backdrop-blur" />
      </Link>

      {movie.trailerUrl && (
        <div className={`z-10 col-start-1 row-start-1 self-center justify-self-center ${REVEAL}`}>
          <TrailerButton url={movie.trailerUrl} title={movie.title} variant="poster" />
        </div>
      )}

      <div className="col-start-1 row-start-2 min-w-0">
        <h3 className="truncate font-bold text-ink-100" title={movie.title}>
          <Link to={detail} className="hover:text-brand-400">{movie.title}</Link>
        </h3>
        <p className="truncate text-xs text-ink-300">
          {movie.genres.map((g) => g.name).join(', ') || 'Chưa phân loại'} · {formatDuration(movie.durationMin)}
        </p>
      </div>

      <div className={`col-start-1 row-start-3 flex flex-col gap-2 [@media(hover:hover)]:z-10 [@media(hover:hover)]:row-start-1 [@media(hover:hover)]:self-end [@media(hover:hover)]:rounded-b [@media(hover:hover)]:bg-black/75 [@media(hover:hover)]:p-2 ${REVEAL}`}>
        {/* Tên phim trên lớp phủ chỉ để nhìn: vẽ bằng CSS nên trang không có hai lần tên (tên thật là tiêu đề ở trên). */}
        <p aria-hidden="true" data-title={movie.title} className="hidden text-center text-sm font-bold uppercase leading-snug text-white before:content-[attr(data-title)] [@media(hover:hover)]:line-clamp-2" />
        <div className="flex flex-wrap gap-2">
          <Link to={detail}
            className="inline-flex h-9 flex-1 items-center justify-center whitespace-nowrap rounded border border-ink-500 px-2 text-xs font-bold uppercase text-ink-100 hover:bg-ink-700 [@media(hover:hover)]:border-white/70 [@media(hover:hover)]:text-white [@media(hover:hover)]:hover:bg-white/20">
            Xem chi tiết
          </Link>
          {movie.status === 'NOW_SHOWING' && (
            <Link to={detail}
              className="inline-flex h-9 flex-1 items-center justify-center whitespace-nowrap rounded bg-brand-600 px-2 text-xs font-bold uppercase text-white hover:bg-brand-500">
              Mua vé
            </Link>
          )}
        </div>
      </div>
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
