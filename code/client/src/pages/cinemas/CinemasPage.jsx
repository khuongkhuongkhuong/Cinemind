import { Link, useSearchParams } from 'react-router-dom';
import { useCinemas, useCities } from '@/hooks/useMovies';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import Skeleton from '@/components/ui/Skeleton';

/** P04 — Danh sách rạp, nhóm theo thành phố; `?city=<id>` chỉ hiện một thành phố. Bấm vào rạp để xem lịch chiếu của rạp đó. */
export default function CinemasPage() {
  const cities = useCities();
  const cinemas = useCinemas();
  const error = cities.error ?? cinemas.error;
  const [params] = useSearchParams();
  const picked = cities.data?.find((c) => c.id === params.get('city')); // mã lạ trên URL thì hiện tất cả
  const shown = picked ? [picked] : cities.data;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 text-3xl font-extrabold">Hệ thống rạp</h1>
      {picked && <p className="-mt-4 mb-6 text-sm"><Link to="/cinemas" className="text-brand-600 hover:underline">← Xem tất cả các rạp</Link></p>}
      {error ? <ErrorState error={error} onRetry={() => { cities.refetch(); cinemas.refetch(); }} />
        : cities.isPending || cinemas.isPending ? <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20" />)}</div>
          : cinemas.data.length === 0 ? <EmptyState title="Chưa có rạp nào" />
            : shown.map((city) => {
              const list = cinemas.data.filter((c) => c.cityId === city.id);
              if (!list.length) return null;
              return (
                <section key={city.id} aria-labelledby={`city-${city.id}`} className="mb-8">
                  <h2 id={`city-${city.id}`} className="mb-3 text-xl font-bold">{city.name}</h2>
                  <ul className="grid gap-3 sm:grid-cols-2">
                    {list.map((c) => (
                      <li key={c.id}>
                        <Link to={`/cinemas/${c.id}`} className="block rounded-xl border border-ink-700 bg-ink-900 p-4 hover:border-brand-500">
                          <p className="font-semibold">{c.name}</p>
                          <p className="text-sm text-ink-300">{c.address}</p>
                          <p className="mt-2 text-sm text-brand-400">Xem lịch chiếu →</p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
    </div>
  );
}
