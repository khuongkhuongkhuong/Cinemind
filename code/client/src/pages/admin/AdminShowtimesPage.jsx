import { useState } from 'react';
import { errorMessage, fieldErrors, hasCode } from '@/api/errors';
import { useAdminCinemas, useAdminMovies, useAdminShowtimes, useCancelShowtime, useCreateShowtime, useUpdateShowtime } from '@/hooks/useAdmin';
import { EMPTY_SHOWTIME, showtimeToBody, showtimeToForm, validateShowtime } from '@/lib/adminForms';
import { formatDateTime, formatMoney, formatTime } from '@/lib/format';
import DataTable from '@/components/admin/DataTable';
import FormModal, { ConfirmDialog } from '@/components/admin/FormModal';
import Button from '@/components/ui/Button';
import SelectField from '@/components/ui/SelectField';
import TextField from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';

const FORMATS = { F2D: '2D', F3D: '3D', IMAX: 'IMAX' };
const AUDIO = { SUBTITLE: 'Phụ đề', DUBBED: 'Lồng tiếng' };
const REASONS = { // lỗi nghiệp vụ -> câu giải thích dễ hiểu (rẽ nhánh theo code, không theo message)
  SHOWTIME_OVERLAP: 'Phòng này đã có suất khác trùng giờ (đã tính 15 phút dọn phòng). Hãy chọn giờ hoặc phòng khác.',
  RESOURCE_IN_USE: 'Suất này đã có người đặt vé nên không thay đổi được. Hãy xử lý (hoàn tiền) các đơn trước.',
};

function ShowtimeForm({ showtime, onClose }) {
  const toast = useToast();
  const isCreate = !showtime;
  const movies = useAdminMovies({ pageSize: 100 });
  const cinemas = useAdminCinemas();
  const create = useCreateShowtime();
  const update = useUpdateShowtime();
  const [form, setForm] = useState(showtime ? showtimeToForm(showtime) : EMPTY_SHOWTIME);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    const local = validateShowtime(form);
    setErrors(local);
    setFormError('');
    if (Object.keys(local).length) return;
    try {
      const body = showtimeToBody(form);
      if (isCreate) await create.mutateAsync(body); else await update.mutateAsync({ id: showtime.id, body });
      toast.success(isCreate ? 'Đã tạo suất chiếu' : 'Đã lưu thay đổi');
      onClose();
    } catch (err) {
      if (hasCode(err, 'VALIDATION_ERROR')) setErrors(fieldErrors(err));
      setFormError(Object.entries(REASONS).find(([code]) => hasCode(err, code))?.[1] ?? errorMessage(err));
    }
  };

  return (
    <FormModal open title={isCreate ? 'Thêm suất chiếu' : 'Sửa suất chiếu'} onClose={onClose} onSubmit={submit} submitting={create.isPending || update.isPending} error={formError}>
      <SelectField label="Phim" value={form.movieId} onChange={set('movieId')}>
        <option value="">— Chọn phim —</option>
        {(movies.data?.items ?? []).filter((m) => m.status !== 'ENDED' || m.id === form.movieId).map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
      </SelectField>
      {errors.movieId && <p className="-mt-3 text-sm text-red-300">{errors.movieId}</p>}
      <SelectField label="Phòng chiếu" value={form.roomId} onChange={set('roomId')}>
        <option value="">— Chọn phòng —</option>
        {(cinemas.data ?? []).map((c) => (
          <optgroup key={c.id} label={c.name}>
            {c.rooms.filter((r) => r.isActive).map((r) => <option key={r.id} value={r.id}>{c.name} · {r.name}</option>)}
          </optgroup>
        ))}
      </SelectField>
      {errors.roomId && <p className="-mt-3 text-sm text-red-300">{errors.roomId}</p>}
      <TextField label="Giờ chiếu (giờ Việt Nam)" type="datetime-local" value={form.start} onChange={set('start')} error={errors.start || errors.startTime} />
      <div className="grid grid-cols-2 gap-4">
        <SelectField label="Định dạng" value={form.format} onChange={set('format')}>
          {Object.entries(FORMATS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </SelectField>
        <SelectField label="Âm thanh" value={form.audio} onChange={set('audio')}>
          {Object.entries(AUDIO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </SelectField>
      </div>
      <TextField label="Giá gốc (VND)" type="number" min="0" step="1000" value={form.basePrice} onChange={set('basePrice')} error={errors.basePrice}
        hint="Để trống: hệ thống tự lấy theo Bảng giá (định dạng + ngày thường/cuối tuần)." />
    </FormModal>
  );
}

export default function AdminShowtimesPage() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [cinemaId, setCinemaId] = useState('');
  const [date, setDate] = useState('');
  const cinemas = useAdminCinemas();
  const list = useAdminShowtimes({ page, pageSize: 15, ...(cinemaId && { cinemaId }), ...(date && { date }) });
  const cancel = useCancelShowtime();
  const [editing, setEditing] = useState(null); // null · 'new' · suất
  const [cancelling, setCancelling] = useState(null);

  const confirmCancel = async () => {
    try { await cancel.mutateAsync(cancelling.id); toast.success('Đã hủy suất chiếu'); } catch (err) {
      toast.error(REASONS[hasCode(err, 'RESOURCE_IN_USE') ? 'RESOURCE_IN_USE' : ''] ?? errorMessage(err));
    } finally { setCancelling(null); }
  };

  const columns = [
    { key: 'time', header: 'Giờ chiếu', render: (s) => <div><p className="font-semibold">{formatDateTime(s.startTime)}</p><p className="text-xs text-ink-300">đến {formatTime(s.endTime)} (gồm dọn phòng)</p></div> },
    { key: 'movie', header: 'Phim', render: (s) => <span className="block max-w-xs truncate">{s.movie.title}</span> },
    { key: 'room', header: 'Rạp / phòng', render: (s) => `${s.cinema.name} · ${s.room.name}` },
    { key: 'fmt', header: 'Định dạng', render: (s) => `${FORMATS[s.format]} · ${AUDIO[s.audio]}` },
    { key: 'price', header: 'Giá gốc', render: (s) => formatMoney(s.basePrice) },
    {
      key: 'status', header: 'Trạng thái',
      render: (s) => <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.status === 'OPEN' ? 'bg-ok/20 text-green-300' : 'bg-ink-600 text-ink-200'}`}>{s.status === 'OPEN' ? 'Đang mở' : 'Đã hủy'}</span>,
    },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (s) => s.status === 'OPEN' && (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => setEditing(s)}>Sửa</Button>
          <Button size="sm" variant="danger" onClick={() => setCancelling(s)}>Hủy suất</Button>
        </div>
      ),
    },
  ];

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold">Quản lý suất chiếu</h1>
        <Button onClick={() => setEditing('new')}>+ Thêm suất chiếu</Button>
      </div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <SelectField label="Lọc theo rạp" value={cinemaId} onChange={(e) => { setCinemaId(e.target.value); setPage(1); }} className="w-full sm:w-64">
          <option value="">Tất cả rạp</option>
          {(cinemas.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectField>
        <TextField label="Ngày chiếu" type="date" value={date} onChange={(e) => { setDate(e.target.value); setPage(1); }} className="w-full sm:w-48" />
        {date && <Button variant="ghost" onClick={() => { setDate(''); setPage(1); }}>Xóa lọc ngày</Button>}
      </div>
      <DataTable
        caption="Danh sách suất chiếu" columns={columns} rows={list.data?.items} loading={list.isPending} error={list.error} onRetry={list.refetch}
        meta={list.data?.meta} onPageChange={setPage} empty={{ title: 'Không có suất chiếu', description: 'Thử đổi bộ lọc hoặc thêm suất mới.' }}
      />
      {editing && <ShowtimeForm key={editing === 'new' ? 'new' : editing.id} showtime={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={Boolean(cancelling)} danger title="Hủy suất chiếu?" confirmLabel="Hủy suất" loading={cancel.isPending} onConfirm={confirmCancel} onClose={() => setCancelling(null)}>
        Hủy suất {cancelling && `${cancelling.movie.title} lúc ${formatDateTime(cancelling.startTime)}`}? Suất đã có người đặt vé sẽ không hủy được.
      </ConfirmDialog>
    </section>
  );
}
