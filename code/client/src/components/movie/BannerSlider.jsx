import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBanners } from '@/hooks/useMovies';
import { safeExternalUrl } from '@/lib/movies';

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const INTERVAL_MS = 5000;

/** Banner: liên kết nội bộ ("/movies/...") dùng <Link>; liên kết ngoài chỉ nhận http(s) và mở tab mới an toàn. */
function BannerLink({ banner, children }) {
  const cls = 'block h-full w-full';
  if (!banner.linkUrl) return <div className={cls}>{children}</div>;
  if (banner.linkUrl.startsWith('/')) return <Link to={banner.linkUrl} className={cls}>{children}</Link>;
  const external = safeExternalUrl(banner.linkUrl);
  if (!external) return <div className={cls}>{children}</div>;
  return <a href={external} target="_blank" rel="noopener noreferrer" className={cls}>{children}</a>;
}

function Slide({ banner }) {
  const [broken, setBroken] = useState(false);
  return (
    <BannerLink banner={banner}>
      <div className="relative h-full w-full bg-gradient-to-br from-brand-700 via-ink-800 to-ink-900">
        {!broken && banner.imageUrl && (
          <img src={banner.imageUrl} alt="" onError={() => setBroken(true)} className="absolute inset-0 h-full w-full object-cover" />
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4 pt-12 sm:p-6">
          <p className="text-lg font-bold text-white sm:text-2xl">{banner.title}</p>
        </div>
      </div>
    </BannerLink>
  );
}

/**
 * Banner trượt trang chủ (05-ui-pages P01). Tự chuyển mỗi 5 giây, tạm dừng khi rê chuột / đang focus,
 * và KHÔNG tự chuyển nếu người dùng bật "giảm chuyển động". Không có banner nào thì không hiển thị gì.
 */
export default function BannerSlider() {
  const { data: banners } = useBanners();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = banners?.length ?? 0;

  useEffect(() => {
    if (count < 2 || paused || prefersReducedMotion()) return undefined;
    const id = setInterval(() => setIndex((i) => (i + 1) % count), INTERVAL_MS);
    return () => clearInterval(id);
  }, [count, paused]);

  if (!count) return null;
  const current = Math.min(index, count - 1);
  const go = (n) => setIndex((n + count) % count);

  return (
    <section
      aria-roledescription="carousel" aria-label="Khuyến mãi nổi bật"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
      className="relative overflow-hidden rounded-2xl"
    >
      <div className="aspect-[16/7] w-full sm:aspect-[21/7]" aria-live={paused ? 'polite' : 'off'}>
        <Slide key={banners[current].id} banner={banners[current]} />
      </div>
      {count > 1 && (
        <>
          <button type="button" aria-label="Banner trước" onClick={() => go(current - 1)}
            className="absolute left-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70">‹</button>
          <button type="button" aria-label="Banner sau" onClick={() => go(current + 1)}
            className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70">›</button>
          <div className="absolute right-4 top-3 flex gap-1.5">
            {banners.map((b, i) => (
              <button key={b.id} type="button" aria-label={`Đến banner ${i + 1}`} aria-current={i === current ? 'true' : undefined} onClick={() => setIndex(i)}
                className={`h-2.5 rounded-full transition-all ${i === current ? 'w-6 bg-white' : 'w-2.5 bg-white/50 hover:bg-white/80'}`} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
