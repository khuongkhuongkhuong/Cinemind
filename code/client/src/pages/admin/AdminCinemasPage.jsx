import { useMemo, useState } from 'react';
import { errorMessage, fieldErrors, hasCode } from '@/api/errors';
import { useAdminCinemas, useCreateCinema, useRoomSeats, useUpdateCinema } from '@/hooks/useAdmin';
import { useCities } from '@/hooks/useMovies';
import { EMPTY_CINEMA, cinemaToBody, cinemaToForm, validateCinema } from '@/lib/adminCatalogForms';
import FormModal from '@/components/admin/FormModal';
import { RoomActions, RoomForm } from '@/components/admin/RoomManager';
import SeatMap, { SeatLegend } from '@/components/booking/SeatMap';
import ErrorState from '@/components/ui/ErrorState';
import Skeleton from '@/components/ui/Skeleton';
import Button from '@/components/ui/Button';
import SelectField from '@/components/ui/SelectField';
import TextField from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';

const NOOP = () => {};
const EMPTY = new Set();

/** Sơ đồ vật lý của phòng (chỉ xem), `actions` = các nút quản lý phòng. Ghế ngưng dùng (isActive=false) hiển thị như "không sử dụng được". */
function RoomSeats({ roomId, actions }) {
  const q = useRoomSeats(roomId);
  const seats = useMemo(
    () => (q.data?.seats ?? []).map((s) => ({ ...s, status: s.isActive ? 'AVAILABLE' : 'UNAVAILABLE' })),
    [q.data],
  );
  if (q.isPending) return <Skeleton className="h-64" />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const counts = { STANDARD: 0, VIP: 0, COUPLE: 0 };
  seats.forEach((s) => { counts[s.type] += 1; });
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900 p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{q.data.room.cinema.name} · {q.data.room.name}</h2>
        {actions}
      </div>
      <p className="mb-4 text-sm text-ink-300">{seats.length} ghế: {counts.STANDARD} thường · {counts.VIP} VIP · {counts.COUPLE} đôi</p>
      <SeatMap seats={seats} rows={q.data.rows} selected={EMPTY} onToggle={NOOP} disabled showPrice={false} />
      <div className="mt-4"><SeatLegend /></div>
    </div>
  );
}

function CinemaForm({ cinema, onClose }) {
  const toast = useToast();
  const isCreate = !cinema;
  const cities = useCities();
  const create = useCreateCinema();
  const update = useUpdateCinema();
  const [form, setForm] = useState(cinema ? cinemaToForm(cinema) : EMPTY_CINEMA);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    const local = validateCinema(form);
    setErrors(local);
    setFormError('');
    if (Object.keys(local).length) return;
    try {
      const body = cinemaToBody(form);
      if (isCreate) await create.mutateAsync(body); else await update.mutateAsync({ id: cinema.id, body });
      toast.success(isCreate ? 'Đã thêm rạp' : 'Đã lưu thay đổi');
      onClose();
    } catch (err) {
      if (hasCode(err, 'VALIDATION_ERROR')) setErrors(fieldErrors(err));
      // RESOURCE_IN_USE (tắt rạp còn suất sắp chiếu đã bán vé): message của server nói rõ phải làm gì.
      setFormError(errorMessage(err));
    }
  };

  return (
    <FormModal open title={isCreate ? 'Thêm rạp' : 'Sửa rạp'} onClose={onClose} onSubmit={submit} submitting={create.isPending || update.isPending} error={formError}>
      <SelectField label="Thành phố" value={form.cityId} onChange={set('cityId')} disabled={!cities.data}>
        <option value="">— Chọn thành phố —</option>
        {(cities.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </SelectField>
      {errors.cityId && <p className="-mt-3 text-sm text-red-300">{errors.cityId}</p>}
      <TextField label="Tên rạp" value={form.name} onChange={set('name')} error={errors.name} maxLength={100} />
      <TextField label="Địa chỉ" value={form.address} onChange={set('address')} error={errors.address} maxLength={255} />
      <TextField label="Số điện thoại (tùy chọn)" value={form.phone} onChange={set('phone')} error={errors.phone} inputMode="numeric" />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} /> Đang hoạt động</label>
      <p className="text-xs text-ink-300">Rạp tắt sẽ biến khỏi trang khách. Không tắt được nếu còn suất sắp chiếu đã có người đặt vé. Phòng được quản lý ngay trên thẻ của từng rạp.</p>
    </FormModal>
  );
}

export default function AdminCinemasPage() {
  const cinemas = useAdminCinemas();
  const [roomId, setRoomId] = useState('');
  const [editing, setEditing] = useState(null); // null · 'new' · rạp
  const [addingTo, setAddingTo] = useState(null); // rạp đang được thêm phòng
  const cinemaOfRoom = cinemas.data?.find((c) => c.rooms.some((r) => r.id === roomId));
  const selected = cinemaOfRoom?.rooms.find((r) => r.id === roomId);

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Rạp & phòng chiếu</h1>
          <p className="text-sm text-ink-300">Thêm / sửa rạp và phòng chiếu; sơ đồ ghế chọn theo mẫu khi thêm phòng.</p>
        </div>
        <Button onClick={() => setEditing('new')}>+ Thêm rạp</Button>
      </div>
      {cinemas.isPending ? <Skeleton className="h-48" /> : cinemas.error ? <ErrorState error={cinemas.error} onRetry={cinemas.refetch} /> : (
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <div className="space-y-4">
            {cinemas.data.map((c) => (
              <div key={c.id} className="rounded-xl border border-ink-700 bg-ink-900 p-4">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold">{c.name}{!c.isActive && <span className="ml-2 rounded-full bg-ink-600 px-2 py-0.5 text-xs font-semibold text-ink-200">Đã tắt</span>}</h2>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(c)} aria-label={`Sửa ${c.name}`}>Sửa</Button>
                </div>
                <p className="mb-3 text-xs text-ink-300">{c.address} · {c.city.name}{c.phone ? ` · ${c.phone}` : ''}</p>
                {c.rooms.length === 0 ? <p className="text-xs text-ink-300">Chưa có phòng chiếu.</p> : (
                  <div className="flex flex-wrap gap-2">
                    {c.rooms.map((r) => (
                      <Button key={r.id} size="sm" variant={roomId === r.id ? 'primary' : 'secondary'} onClick={() => setRoomId(r.id)} aria-pressed={roomId === r.id}
                        aria-label={`Xem sơ đồ ${c.name} ${r.name}, ${r.seatCount} ghế${r.isActive ? '' : ', đã ngưng'}`}>
                        <span className={r.isActive ? '' : 'line-through opacity-60'}>{r.name}</span> <span className="text-xs opacity-70">({r.seatCount})</span>
                        {!r.isActive && <span className="ml-1 text-xs font-bold">Ngưng</span>}
                      </Button>
                    ))}
                  </div>
                )}
                <Button size="sm" variant="ghost" className="mt-3 w-full border border-dashed border-ink-500" onClick={() => setAddingTo(c)} aria-label={`Thêm phòng cho ${c.name}`}>+ Phòng</Button>
              </div>
            ))}
          </div>
          <div className="min-w-0">{selected ? (
            <RoomSeats key={selected.id} roomId={selected.id}
              actions={<RoomActions cinema={cinemaOfRoom} room={selected} onDeleted={() => setRoomId('')} />} />
          ) : <p className="rounded-xl border border-dashed border-ink-600 p-10 text-center text-ink-300">Chọn một phòng để xem sơ đồ ghế.</p>}</div>
        </div>
      )}
      {addingTo && <RoomForm cinema={addingTo} onClose={() => setAddingTo(null)} onCreated={(r) => setRoomId(r.id)} />}
      {editing && <CinemaForm key={editing === 'new' ? 'new' : editing.id} cinema={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}
