import { useState } from 'react';
import { errorMessage, fieldErrors, hasCode } from '@/api/errors';
import { useAdminCinemas, useAdminShowtimes, useCancelShowtime, useCreateShowtime, useUpdateShowtime } from '@/hooks/useAdmin';
import { EMPTY_SHOWTIME, showtimeToBody, showtimeToForm, validateShowtime } from '@/lib/adminForms';
import { formatDateTime, formatMoney, formatTime, vnDateKey } from '@/lib/format';
import BulkShowtimeForm from '@/components/admin/BulkShowtimeForm';
import ShowtimeFields, { AUDIO, FORMATS } from '@/components/admin/ShowtimeFields';
import ShowtimeTimeline from '@/components/admin/ShowtimeTimeline';
import { startingOn } from '@/lib/showtimePlan';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import Skeleton from '@/components/ui/Skeleton';
import DataTable from '@/components/admin/DataTable';
import FormModal, { ConfirmDialog } from '@/components/admin/FormModal';
import Button from '@/components/ui/Button';
import SelectField from '@/components/ui/SelectField';
import TextField from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';

const REASONS = { // lỗi nghiệp vụ -> câu giải thích dễ hiểu (rẽ nhánh theo code, không theo message)
  SHOWTIME_OVERLAP: 'Phòng này đã có suất khác trùng giờ (đã tính 15 phút dọn phòng). Hãy chọn giờ hoặc phòng khác.',
  RESOURCE_IN_USE: 'Suất này đã có người đặt vé nên không thay đổi được. Hãy xử lý (hoàn tiền) các đơn trước.',
};

function ShowtimeForm({ showtime, defaults, onClose, onCancelShowtime }) {
  const toast = useToast();
  const isCreate = !showtime;
  const create = useCreateShowtime();
  const update = useUpdateShowtime();
  const [form, setForm] = useState(showtime ? showtimeToForm(showtime) : { ...EMPTY_SHOWTIME, ...defaults });
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
      {showtime?.bookedSeats > 0 && (
        <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-gold-400">
          Suất này có {showtime.bookedSeats} ghế đã đặt nên không sửa hoặc hủy được.
        </p>
      )}
      <ShowtimeFields form={form} set={set} errors={errors}>
        <TextField label="Giờ chiếu (giờ Việt Nam)" type="datetime-local" value={form.start} onChange={set('start')} error={errors.start || errors.startTime} />
      </ShowtimeFields>
      {showtime && onCancelShowtime && (
        <Button variant="danger" size="sm" onClick={() => onCancelShowtime(showtime)}>Hủy suất này</Button>
      )}
    </FormModal>
  );
}

/** Chế độ "Lịch theo phòng": một rạp, một ngày, xem hết các phòng cùng lúc. */
function TimelineView({ cinemas, cinemaId, onCinema, date, onDate, onAdd, onOpen }) {
  const cinema = cinemas.find((c) => c.id === cinemaId);
  // pageSize 100 là trần của API: đủ cho một rạp một ngày (12 phòng, khoảng 6-7 suất mỗi phòng).
  // Không giữ dữ liệu của ngày / rạp trước trong lúc tải (placeholderData): lịch phải đúng với ô đang chọn.
  const list = useAdminShowtimes({ cinemaId, date, page: 1, pageSize: 100 }, { enabled: Boolean(cinemaId && date), placeholderData: undefined });
  const shift = (days) => onDate(new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <SelectField label="Rạp" value={cinemaId} onChange={(e) => onCinema(e.target.value)} className="w-full sm:w-64">
          {cinemas.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectField>
        <TextField label="Ngày" type="date" value={date} onChange={(e) => e.target.value && onDate(e.target.value)} className="w-full sm:w-48" />
        <Button variant="secondary" onClick={() => shift(-1)}>← Ngày trước</Button>
        <Button variant="secondary" onClick={() => shift(1)}>Ngày sau →</Button>
      </div>
      {list.error ? <ErrorState error={list.error} onRetry={list.refetch} />
        : !cinema || list.isPending ? <Skeleton className="h-64" />
          : cinema.rooms.length === 0 ? <EmptyState title="Rạp chưa có phòng chiếu" />
            : (
              <>
                <p className="text-sm text-ink-300" role="status">
                  {startingOn(list.data.items, date).filter((s) => s.status === 'OPEN' && cinema.rooms.some((r) => r.isActive && r.id === s.room.id)).length} suất đang mở. Bấm chỗ trống để thêm, bấm khối phim để sửa. 🎟 là số ghế đã đặt.
                </p>
                {list.data.meta.total > 100 && <p role="alert" className="text-sm text-red-300">Ngày này có hơn 100 suất, lịch chỉ hiện 100 suất đầu. Xem đủ ở chế độ Danh sách.</p>}
                <ShowtimeTimeline rooms={cinema.rooms.filter((r) => r.isActive)} showtimes={list.data.items} date={date} onAdd={onAdd} onOpen={onOpen} />
              </>
            )}
    </div>
  );
}

export default function AdminShowtimesPage() {
  const toast = useToast();
  const [view, setView] = useState('timeline');
  const [planCinema, setPlanCinema] = useState('');
  const [planDate, setPlanDate] = useState(() => vnDateKey());
  const [defaults, setDefaults] = useState({});
  const [bulk, setBulk] = useState(null); // null = đóng · object = giá trị điền sẵn
  const [page, setPage] = useState(1);
  const [cinemaId, setCinemaId] = useState('');
  const [date, setDate] = useState('');
  const cinemas = useAdminCinemas();
  const list = useAdminShowtimes({ page, pageSize: 15, ...(cinemaId && { cinemaId }), ...(date && { date }) });
  const cancel = useCancelShowtime();
  const timelineCinema = planCinema || cinemas.data?.[0]?.id || '';
  const addShowtime = (roomId = '', start = '') => { setDefaults({ roomId, start }); setEditing('new'); };
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
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setBulk(view === 'timeline' ? { from: planDate, to: planDate } : {})}>Tạo hàng loạt</Button>
          <Button onClick={() => addShowtime()}>+ Thêm suất chiếu</Button>
        </div>
      </div>
      <div role="tablist" aria-label="Chế độ xem" className="mb-4 flex gap-2">
        {[['timeline', 'Lịch theo phòng'], ['list', 'Danh sách']].map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => setView(key)}
            className={`rounded-lg border px-4 py-2 text-sm font-semibold ${view === key ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-600 bg-ink-900 hover:bg-ink-700'}`}>
            {label}
          </button>
        ))}
      </div>
      {view === 'timeline' && (cinemas.error ? <ErrorState error={cinemas.error} onRetry={cinemas.refetch} /> : (
        <TimelineView cinemas={cinemas.data ?? []} cinemaId={timelineCinema} onCinema={setPlanCinema} date={planDate} onDate={setPlanDate}
          onAdd={addShowtime} onOpen={setEditing} />
      ))}
      {view === 'list' && (<>
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
      </>)}
      {editing && (
        <ShowtimeForm key={editing === 'new' ? 'new' : editing.id} showtime={editing === 'new' ? null : editing} defaults={defaults} onClose={() => setEditing(null)}
          onCancelShowtime={view === 'timeline' ? (s) => { setEditing(null); setCancelling(s); } : undefined} />
      )}
      {bulk && <BulkShowtimeForm initial={bulk} onClose={() => setBulk(null)} />}
      <ConfirmDialog open={Boolean(cancelling)} danger title="Hủy suất chiếu?" confirmLabel="Hủy suất" loading={cancel.isPending} onConfirm={confirmCancel} onClose={() => setCancelling(null)}>
        Hủy suất {cancelling && `${cancelling.movie.title} lúc ${formatDateTime(cancelling.startTime)}`}? Suất đã có người đặt vé sẽ không hủy được.
      </ConfirmDialog>
    </section>
  );
}
