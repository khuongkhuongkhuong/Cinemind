import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useGenres, useMovies } from '@/hooks/useMovies';
import { useDebounce } from '@/hooks/useDebounce';
import { apiStatusToUrl, urlStatusToApi } from '@/lib/movies';
import MovieCard, { MovieCardSkeleton } from '@/components/movie/MovieCard';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import Pagination from '@/components/ui/Pagination';
import SelectField from '@/components/ui/SelectField';

const PAGE_SIZE = 10;
const TABS = [{ value: 'now', label: 'Đang chiếu' }, { value: 'soon', label: 'Sắp chiếu' }];

/**
 * P02 — Danh sách phim. Toàn bộ bộ lọc nằm trên URL (`?status=now|soon&q=&genre=&page=`): chia sẻ được đường dẫn,
 * nút Back của trình duyệt hoạt động đúng, tải lại trang vẫn giữ nguyên bộ lọc.
 */
export default function MoviesPage() {
  const [params, setParams] = useSearchParams();
  const statusParam = apiStatusToUrl(urlStatusToApi(params.get('status')));
  const q = params.get('q') ?? '';
  const genre = params.get('genre') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);

  // Ô tìm kiếm có state riêng (gõ mượt), chỉ ghi lên URL sau khi người dùng ngừng gõ.
  const [text, setText] = useState(q);
  const debounced = useDebounce(text, 400);
  useEffect(() => setText(q), [q]); // URL đổi từ bên ngoài (ô tìm kiếm ở Header, nút Back)

  const update = (changes, { resetPage = true } = {}) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    if (resetPage) next.delete('page');
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if (debounced.trim() !== q) update({ q: debounced.trim() });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ phản ứng khi giá trị đã debounce đổi
  }, [debounced]);

  const genres = useGenres();
  const { data, isPending, isError, error, refetch, isPlaceholderData } = useMovies({
    status: urlStatusToApi(statusParam), q: q || undefined, genreId: genre || undefined, page, pageSize: PAGE_SIZE,
  });

  const hasFilter = Boolean(q || genre);
  const clear = () => { setText(''); setParams(new URLSearchParams({ status: statusParam }), { replace: true }); };

  return (
    <div>
      <h1 className="text-3xl font-black">Phim</h1>

      <div role="tablist" aria-label="Loại phim" className="mt-4 flex gap-2">
        {TABS.map((t) => (
          <button key={t.value} role="tab" type="button" aria-selected={statusParam === t.value} onClick={() => update({ status: t.value })}
            className={`h-10 rounded-lg px-4 text-sm font-semibold transition-colors ${statusParam === t.value ? 'bg-brand-600 text-white' : 'bg-ink-800 text-ink-300 hover:text-white'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1 sm:max-w-sm">
          <label htmlFor="movie-search" className="sr-only">Tìm phim theo tên</label>
          <input id="movie-search" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Tìm phim theo tên (không cần gõ dấu)"
            className="h-10 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 text-sm placeholder:text-ink-300/60 hover:border-ink-300" />
        </div>
        <SelectField label="Thể loại" hideLabel value={genre} onChange={(e) => update({ genre: e.target.value })} className="w-48">
          <option value="">Tất cả thể loại</option>
          {genres.data?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </SelectField>
        {hasFilter && <Button variant="ghost" onClick={clear}>Xóa bộ lọc</Button>}
      </div>

      <div className="mt-6" aria-live="polite">
        {isError ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : isPending ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">{Array.from({ length: 10 }, (_, i) => <MovieCardSkeleton key={i} />)}</div>
        ) : data.items.length === 0 ? (
          <EmptyState
            title={hasFilter ? 'Không tìm thấy phim phù hợp' : 'Chưa có phim'}
            description={hasFilter ? 'Hãy thử từ khóa khác hoặc bỏ bớt bộ lọc.' : 'Hiện chưa có phim nào trong nhóm này.'}
            action={hasFilter && <Button variant="secondary" onClick={clear}>Xóa bộ lọc</Button>}
          />
        ) : (
          <>
            <p className="mb-3 text-sm text-ink-300">{data.meta.total} phim</p>
            <div className={`grid grid-cols-2 gap-4 transition-opacity sm:grid-cols-3 lg:grid-cols-5 ${isPlaceholderData ? 'opacity-60' : ''}`}>
              {data.items.map((m) => <MovieCard key={m.id} movie={m} />)}
            </div>
            <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onChange={(p) => update({ page: p > 1 ? String(p) : '' }, { resetPage: false })} />
          </>
        )}
      </div>
    </div>
  );
}
