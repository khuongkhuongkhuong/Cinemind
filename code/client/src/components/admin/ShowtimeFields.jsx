import { useAdminCinemas, useAdminMovies } from '@/hooks/useAdmin';
import SelectField from '@/components/ui/SelectField';
import TextField from '@/components/ui/TextField';

export const FORMATS = { F2D: '2D', F3D: '3D', IMAX: 'IMAX' };
export const AUDIO = { SUBTITLE: 'Phụ đề', DUBBED: 'Lồng tiếng' };

/** Các ô chung của form một suất và form tạo hàng loạt: phim, phòng, [phần thời gian = `children`], định dạng, âm thanh, giá. */
export default function ShowtimeFields({ form, set, errors, children }) {
  const movies = useAdminMovies({ pageSize: 100 });
  const cinemas = useAdminCinemas();
  return (
    <>
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
      {children}
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
    </>
  );
}
