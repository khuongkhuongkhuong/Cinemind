import { useState } from 'react';
import { errorMessage, fieldErrors, hasCode } from '@/api/errors';
import { getMovie } from '@/api/catalog.api';
import { useAdminMovies, useCreateMovie, useDeleteMovie, useSetMovieStatus, useUpdateMovie } from '@/hooks/useAdmin';
import { useGenres } from '@/hooks/useMovies';
import { useDebounce } from '@/hooks/useDebounce';
import { EMPTY_MOVIE, movieToBody, movieToForm, validateMovie } from '@/lib/adminForms';
import { formatDateOnly } from '@/lib/format';
import DataTable from '@/components/admin/DataTable';
import FormModal, { ConfirmDialog } from '@/components/admin/FormModal';
import Button from '@/components/ui/Button';
import SelectField from '@/components/ui/SelectField';
import TextField from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';

const STATUS = { COMING_SOON: 'Sắp chiếu', NOW_SHOWING: 'Đang chiếu', ENDED: 'Ngừng chiếu' };
const AGES = ['P', 'K', 'T13', 'T16', 'T18'];

function MovieForm({ movie, onClose }) {
  const toast = useToast();
  const isCreate = !movie;
  const genres = useGenres();
  const create = useCreateMovie();
  const update = useUpdateMovie();
  const [form, setForm] = useState(movie ? movieToForm(movie) : EMPTY_MOVIE);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggleGenre = (id) => setForm((f) => ({ ...f, genreIds: f.genreIds.includes(id) ? f.genreIds.filter((g) => g !== id) : [...f.genreIds, id] }));
  const submitting = create.isPending || update.isPending;

  const submit = async () => {
    const local = validateMovie(form);
    setErrors(local);
    setFormError('');
    if (Object.keys(local).length) return;
    try {
      const body = movieToBody(form, isCreate);
      if (isCreate) await create.mutateAsync(body); else await update.mutateAsync({ id: movie.id, body });
      toast.success(isCreate ? 'Đã thêm phim' : 'Đã lưu thay đổi');
      onClose();
    } catch (err) {
      if (hasCode(err, 'VALIDATION_ERROR')) setErrors(fieldErrors(err));
      setFormError(errorMessage(err));
    }
  };

  return (
    <FormModal open title={isCreate ? 'Thêm phim' : 'Sửa phim'} onClose={onClose} onSubmit={submit} submitting={submitting} error={formError} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Tên phim" value={form.title} onChange={set('title')} error={errors.title} className="sm:col-span-2" maxLength={200} />
        <TextField label="Thời lượng (phút)" type="number" min="1" max="600" value={form.durationMin} onChange={set('durationMin')} error={errors.durationMin} />
        <TextField label="Ngày khởi chiếu" type="date" value={form.releaseDate} onChange={set('releaseDate')} error={errors.releaseDate} />
        <SelectField label="Phân loại độ tuổi" value={form.ageRating} onChange={set('ageRating')}>
          {AGES.map((a) => <option key={a} value={a}>{a}</option>)}
        </SelectField>
        {isCreate && (
          <SelectField label="Trạng thái" value={form.status} onChange={set('status')}>
            {Object.entries(STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </SelectField>
        )}
        <div className="sm:col-span-2">
          <label htmlFor="movie-desc" className="mb-1 block text-sm font-medium text-ink-100">Mô tả</label>
          <textarea id="movie-desc" rows={4} value={form.description} onChange={set('description')} maxLength={5000}
            aria-invalid={errors.description ? true : undefined}
            className={`w-full rounded-lg border bg-ink-800 px-3 py-2 text-ink-100 ${errors.description ? 'border-bad' : 'border-ink-500'}`} />
          {errors.description && <p className="mt-1 text-sm text-red-300">{errors.description}</p>}
        </div>
        <TextField label="Đạo diễn" value={form.director} onChange={set('director')} />
        <TextField label="Ngôn ngữ" value={form.language} onChange={set('language')} />
        <TextField label="Diễn viên" value={form.actors} onChange={set('actors')} className="sm:col-span-2" />
        <TextField label="URL poster" value={form.posterUrl} onChange={set('posterUrl')} error={errors.posterUrl} placeholder="https://…" className="sm:col-span-2" />
        <TextField label="URL trailer" value={form.trailerUrl} onChange={set('trailerUrl')} error={errors.trailerUrl} placeholder="https://…" className="sm:col-span-2" />
        <fieldset className="sm:col-span-2">
          <legend className="mb-1 text-sm font-medium text-ink-100">Thể loại</legend>
          <div className="flex flex-wrap gap-2">
            {(genres.data ?? []).map((g) => (
              <label key={g.id} className={`cursor-pointer rounded-full border px-3 py-1 text-sm ${form.genreIds.includes(g.id) ? 'border-brand-500 bg-brand-600/30' : 'border-ink-600'}`}>
                <input type="checkbox" className="sr-only" checked={form.genreIds.includes(g.id)} onChange={() => toggleGenre(g.id)} />
                {g.name}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </FormModal>
  );
}

export default function AdminMoviesPage() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const debouncedQ = useDebounce(q, 300);
  const list = useAdminMovies({ page, pageSize: 10, ...(debouncedQ && { q: debouncedQ }), ...(status && { status }) });
  const setMovieStatus = useSetMovieStatus();
  const remove = useDeleteMovie();
  const [editing, setEditing] = useState(null); // null = đóng · 'new' = thêm · object phim = sửa
  const [deleting, setDeleting] = useState(null);
  const [opening, setOpening] = useState(false);

  // Danh sách chỉ có bản tóm tắt; mở form sửa thì lấy bản đầy đủ (mô tả, đạo diễn, trailer...).
  const openEdit = async (m) => {
    setOpening(true);
    try { setEditing(await getMovie(m.slug)); } catch (err) { toast.error(errorMessage(err)); } finally { setOpening(false); }
  };
  const changeStatus = async (m, next) => {
    try { await setMovieStatus.mutateAsync({ id: m.id, status: next }); toast.success('Đã đổi trạng thái'); } catch (err) { toast.error(errorMessage(err)); }
  };
  const confirmDelete = async () => {
    try { await remove.mutateAsync(deleting.id); toast.success('Đã xóa phim'); setDeleting(null); } catch (err) {
      // RESOURCE_IN_USE: phim đã có suất chiếu -> gợi ý chuyển sang "Ngừng chiếu" thay vì xóa.
      toast.error(hasCode(err, 'RESOURCE_IN_USE') ? 'Phim đã có suất chiếu nên không xóa được. Hãy chuyển sang "Ngừng chiếu".' : errorMessage(err));
      setDeleting(null);
    }
  };

  const columns = [
    { key: 'title', header: 'Phim', render: (m) => <div className="max-w-xs"><p className="truncate font-semibold">{m.title}</p><p className="text-xs text-ink-300">{m.durationMin} phút · {m.ageRating}</p></div> },
    { key: 'releaseDate', header: 'Khởi chiếu', render: (m) => formatDateOnly(m.releaseDate) },
    {
      key: 'status', header: 'Trạng thái',
      render: (m) => (
        <SelectField label={`Trạng thái của ${m.title}`} hideLabel value={m.status} onChange={(e) => changeStatus(m, e.target.value)} disabled={setMovieStatus.isPending}>
          {Object.entries(STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </SelectField>
      ),
    },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (m) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => openEdit(m)} disabled={opening} aria-label={`Sửa ${m.title}`}>Sửa</Button>
          <Button size="sm" variant="danger" onClick={() => setDeleting(m)} aria-label={`Xóa ${m.title}`}>Xóa</Button>
        </div>
      ),
    },
  ];

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold">Quản lý phim</h1>
        <Button onClick={() => setEditing('new')}>+ Thêm phim</Button>
      </div>
      <div className="mb-4 flex flex-wrap gap-3">
        <TextField label="Tìm theo tên" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="w-full sm:w-72" />
        <SelectField label="Lọc trạng thái" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-full self-end sm:w-48">
          <option value="">Tất cả trạng thái</option>
          {Object.entries(STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </SelectField>
      </div>
      <DataTable
        caption="Danh sách phim" columns={columns} rows={list.data?.items} loading={list.isPending} error={list.error} onRetry={list.refetch}
        meta={list.data?.meta} onPageChange={setPage} empty={{ title: 'Không có phim nào', description: 'Thử đổi bộ lọc hoặc thêm phim mới.' }}
      />
      {editing && <MovieForm key={editing === 'new' ? 'new' : editing.id} movie={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={Boolean(deleting)} danger title="Xóa phim?" confirmLabel="Xóa" loading={remove.isPending} onConfirm={confirmDelete} onClose={() => setDeleting(null)}>
        Xóa vĩnh viễn “{deleting?.title}”? Phim đã có suất chiếu sẽ không xóa được.
      </ConfirmDialog>
    </section>
  );
}
