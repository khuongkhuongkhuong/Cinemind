import { useState } from 'react';
import { errorMessage, fieldErrors, hasCode } from '@/api/errors';
import { useCreateRoom, useDeleteRoom, useUpdateRoom } from '@/hooks/useAdmin';
import FormModal, { ConfirmDialog } from '@/components/admin/FormModal';
import Button from '@/components/ui/Button';
import SelectField from '@/components/ui/SelectField';
import TextField from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';

const TEMPLATES = {
  SMALL: 'Nhỏ — 60 ghế (6 hàng × 10)',
  MEDIUM: 'Vừa — 96 ghế (8 hàng × 12)',
  LARGE: 'Lớn — 140 ghế (10 hàng × 14)',
};

/** "Phòng N" nhỏ nhất chưa dùng trong rạp. */
function nextRoomName(rooms) {
  const used = new Set(rooms.map((r) => r.name));
  let n = 1;
  while (used.has(`Phòng ${n}`)) n += 1;
  return `Phòng ${n}`;
}

/** Hộp thoại thêm phòng (không có `room`) hoặc đổi tên phòng (có `room`). */
export function RoomForm({ cinema, room, onClose, onCreated }) {
  const toast = useToast();
  const create = useCreateRoom();
  const update = useUpdateRoom();
  const [name, setName] = useState(() => room?.name ?? nextRoomName(cinema.rooms));
  const [template, setTemplate] = useState('MEDIUM');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');

  const submit = async () => {
    setFormError('');
    if (!name.trim()) { setErrors({ name: 'Vui lòng nhập tên phòng' }); return; }
    setErrors({});
    try {
      if (room) {
        await update.mutateAsync({ id: room.id, body: { name: name.trim() } });
        toast.success('Đã đổi tên phòng');
      } else {
        const created = await create.mutateAsync({ cinemaId: cinema.id, body: { name: name.trim(), template } });
        toast.success(`Đã thêm ${created.name}`);
        onCreated?.(created);
      }
      onClose();
    } catch (err) {
      if (hasCode(err, 'VALIDATION_ERROR')) setErrors(fieldErrors(err));
      setFormError(errorMessage(err));
    }
  };

  return (
    <FormModal open title={room ? `Đổi tên ${room.name}` : `Thêm phòng · ${cinema.name}`} onClose={onClose} onSubmit={submit}
      submitting={create.isPending || update.isPending} error={formError}>
      <TextField label="Tên phòng" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} maxLength={30} />
      {!room && (
        <>
          <SelectField label="Mẫu sơ đồ ghế" value={template} onChange={(e) => setTemplate(e.target.value)}>
            {Object.entries(TEMPLATES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </SelectField>
          <p className="text-xs text-ink-300">Hàng cuối là ghế đôi, các hàng đầu là ghế thường, còn lại là VIP. Sơ đồ ghế không sửa được sau khi tạo.</p>
        </>
      )}
    </FormModal>
  );
}

/** Các nút thao tác của phòng đang chọn: đổi tên, ngưng / mở lại, xóa. */
export function RoomActions({ cinema, room, onDeleted }) {
  const toast = useToast();
  const update = useUpdateRoom();
  const remove = useDeleteRoom();
  const [dialog, setDialog] = useState(null); // null · 'rename' · 'off' · 'delete'

  /** Chạy thao tác rồi đóng hộp thoại; server từ chối (409) thì message nói rõ phải làm gì. */
  const run = async (action, success, after) => {
    try {
      await action();
      toast.success(success);
      after?.();
    } catch (err) {
      toast.error(errorMessage(err));
    }
    setDialog(null);
  };
  const setActive = (isActive) => run(() => update.mutateAsync({ id: room.id, body: { isActive } }), isActive ? 'Đã mở lại phòng' : 'Đã ngưng phòng');

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" onClick={() => setDialog('rename')}>Đổi tên</Button>
      {room.isActive
        ? <Button size="sm" variant="secondary" onClick={() => setDialog('off')}>Ngưng phòng</Button>
        : <Button size="sm" onClick={() => setActive(true)} loading={update.isPending}>Mở lại</Button>}
      <Button size="sm" variant="danger" onClick={() => setDialog('delete')}>Xóa phòng</Button>

      {dialog === 'rename' && <RoomForm cinema={cinema} room={room} onClose={() => setDialog(null)} />}
      <ConfirmDialog open={dialog === 'off'} title={`Ngưng ${room.name}?`} confirmLabel="Ngưng phòng" loading={update.isPending}
        onConfirm={() => setActive(false)} onClose={() => setDialog(null)}>
        <p className="text-sm">Các suất chiếu của phòng sẽ ẩn khỏi trang khách và ngừng bán, mở lại phòng thì hiện như cũ. Không ngưng được nếu còn suất sắp chiếu đã có người đặt vé.</p>
      </ConfirmDialog>
      <ConfirmDialog open={dialog === 'delete'} title={`Xóa ${room.name}?`} confirmLabel="Xóa" danger loading={remove.isPending}
        onConfirm={() => run(() => remove.mutateAsync(room.id), 'Đã xóa phòng', onDeleted)} onClose={() => setDialog(null)}>
        <p className="text-sm">Xóa cả sơ đồ ghế, không hoàn tác được. Chỉ xóa được phòng chưa từng có suất chiếu.</p>
      </ConfirmDialog>
    </div>
  );
}
