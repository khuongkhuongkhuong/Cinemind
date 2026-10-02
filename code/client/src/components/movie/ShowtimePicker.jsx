import { useEffect, useMemo, useState } from 'react';
import { useCities, useShowtimes } from '@/hooks/useMovies';
import { nextDays } from '@/lib/format';
import { countOpenShowtimes, countShowtimes, showGroupLabel } from '@/lib/movies';
import TimeChip from '@/components/movie/TimeChip';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import SelectField from '@/components/ui/SelectField';
import Skeleton from '@/components/ui/Skeleton';

const CITY_KEY = 'cinemind:city';
const readCity = () => { try { return localStorage.getItem(CITY_KEY); } catch { return null; } };
const saveCity = (id) => { try { localStorage.setItem(CITY_KEY, id); } catch { /* chỉ là tiện ích nhớ lựa chọn */ } };

/**
 * Chọn suất chiếu: thành phố → ngày (7 ngày) → rạp → định dạng → giờ (05-ui-pages P03).
 * Giờ hiển thị theo giờ Việt Nam; thông tin "còn mở bán hay không" do server quyết định (`isOpenForSale`).
 */
export default function ShowtimePicker({ movieId }) {
  const days = useMemo(() => nextDays(7), []);
  const cities = useCities();
  const [cityId, setCityId] = useState(null);
  const [date, setDate] = useState(days[0].key);

  // Chọn thành phố mặc định: lần trước đã chọn (nếu còn), không thì thành phố đầu tiên.
  useEffect(() => {
    if (cityId || !cities.data?.length) return;
    const remembered = readCity();
    setCityId(cities.data.some((c) => c.id === remembered) ? remembered : cities.data[0].id);
  }, [cities.data, cityId]);

  const showtimes = useShowtimes({ movieId, date, cityId });
  const open = countOpenShowtimes(showtimes.data);

  const changeCity = (e) => { setCityId(e.target.value); saveCity(e.target.value); };

  return (
    <section aria-labelledby="showtimes-title" className="rounded-2xl border border-ink-700 bg-ink-900 p-4 sm:p-6">
      <h2 id="showtimes-title" className="text-xl font-bold">Lịch chiếu</h2>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <SelectField label="Thành phố" value={cityId ?? ''} onChange={changeCity} disabled={!cities.data} className="w-48">
          {cities.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectField>
      </div>

      <div role="tablist" aria-label="Chọn ngày" className="mt-4 flex gap-2 overflow-x-auto pb-2">
        {days.map((d, i) => (
          <button key={d.key} role="tab" type="button" aria-selected={date === d.key} onClick={() => setDate(d.key)}
            className={`flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl border text-sm transition-colors ${date === d.key ? 'border-brand-500 bg-brand-600 text-white' : 'border-ink-600 bg-ink-800 text-ink-100 hover:border-ink-300'}`}>
            <span className="text-xs opacity-80">{i === 0 ? 'Hôm nay' : d.weekday}</span>
            <span className="font-bold">{d.label}</span>
          </button>
        ))}
      </div>

      <div className="mt-4" aria-live="polite">
        {cities.isError ? (
          <ErrorState error={cities.error} title="Không tải được danh sách thành phố" onRetry={cities.refetch} />
        ) : showtimes.isError ? (
          <ErrorState error={showtimes.error} title="Không tải được lịch chiếu" onRetry={showtimes.refetch} />
        ) : !cityId || showtimes.isPending ? (
          <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-20" />)}</div>
        ) : countShowtimes(showtimes.data) === 0 ? (
          <EmptyState title="Chưa có suất chiếu" description="Không có suất nào trong ngày này ở thành phố đã chọn. Hãy thử ngày khác hoặc thành phố khác." />
        ) : (
          <div className="space-y-5">
            {open === 0 && (
              <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-gold-400">Các suất của ngày này đã đóng bán. Hãy chọn ngày khác.</p>
            )}
            {showtimes.data.cinemas.map(({ cinema, groups }) => (
              <div key={cinema.id}>
                <h3 className="font-semibold text-ink-100">{cinema.name}</h3>
                <p className="text-xs text-ink-300">{cinema.address}</p>
                <div className="mt-3 space-y-3">
                  {groups.map((g) => (
                    <div key={`${g.format}-${g.audio}`} className="flex flex-wrap items-center gap-3">
                      <span className="w-28 shrink-0 text-sm text-ink-300">{showGroupLabel(g)}</span>
                      <div className="flex flex-wrap gap-2">{g.showtimes.map((t) => <TimeChip key={t.id} showtime={t} />)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
