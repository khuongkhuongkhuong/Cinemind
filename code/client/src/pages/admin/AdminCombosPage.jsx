import { useState } from 'react';
import { errorMessage, fieldErrors, hasCode } from '@/api/errors';
import { useAdminCombos, useCreateCombo, useDeleteCombo, useUpdateCombo } from '@/hooks/useAdmin';
import { EMPTY_COMBO, comboToBody, comboToForm, validateCombo } from '@/lib/adminCatalogForms';
import { formatMoney } from '@/lib/format';
import DataTable from '@/components/admin/DataTable';
import FormModal, { ConfirmDialog } from '@/components/admin/FormModal';
import Button from '@/components/ui/Button';
import TextField from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';

function ComboForm({ combo, onClose }) {
  const toast = useToast();
  const isCreate = !combo;
  const create = useCreateCombo();
  const update = useUpdateCombo();
  const [form, setForm] = useState(combo ? comboToForm(combo) : EMPTY_COMBO);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    const local = validateCombo(form);
    setErrors(local);
    setFormError('');
    if (Object.keys(local).length) return;
    try {
      const body = comboToBody(form);
      if (isCreate) await create.mutateAsync(body); else await update.mutateAsync({ id: combo.id, body });
      toast.success(isCreate ? 'Đã thêm combo' : 'Đã lưu thay đổi');
      onClose();
    } catch (err) {
      if (hasCode(err, 'VALIDATION_ERROR')) setErrors(fieldErrors(err));
      setFormError(errorMessage(err));
    }
  };

  return (
    <FormModal open title={isCreate ? 'Thêm combo' : 'Sửa combo'} onClose={onClose} onSubmit={submit} submitting={create.isPending || update.isPending} error={formError}>
      <TextField label="Tên combo" value={form.name} onChange={set('name')} error={errors.name} maxLength={100} />
      <TextField label="Mô tả" value={form.description} onChange={set('description')} error={errors.description} maxLength={300} />
      <TextField label="Giá (VND)" type="number" min="0" step="1000" value={form.price} onChange={set('price')} error={errors.price}
        hint="Đổi giá không ảnh hưởng đơn đã tạo (giá được chốt vào đơn)." />
      <TextField label="URL ảnh" value={form.imageUrl} onChange={set('imageUrl')} error={errors.imageUrl} placeholder="https://…" />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} /> Đang bán</label>
    </FormModal>
  );
}

export default function AdminCombosPage() {
  const toast = useToast();
  const list = useAdminCombos();
  const remove = useDeleteCombo();
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const confirmDelete = async () => {
    try { await remove.mutateAsync(deleting.id); toast.success('Đã xóa combo'); } catch (err) {
      toast.error(hasCode(err, 'RESOURCE_IN_USE') ? 'Combo đã nằm trong đơn hàng nên không xóa được. Hãy bỏ chọn "Đang bán".' : errorMessage(err));
    } finally { setDeleting(null); }
  };

  const columns = [
    { key: 'name', header: 'Combo', render: (c) => <div className="max-w-sm"><p className="font-semibold">{c.name}</p><p className="truncate text-xs text-ink-300">{c.description}</p></div> },
    { key: 'price', header: 'Giá', render: (c) => formatMoney(c.price) },
    { key: 'isActive', header: 'Trạng thái', render: (c) => <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${c.isActive ? 'bg-ok/20 text-green-300' : 'bg-ink-600 text-ink-200'}`}>{c.isActive ? 'Đang bán' : 'Ngừng bán'}</span> },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (c) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => setEditing(c)} aria-label={`Sửa ${c.name}`}>Sửa</Button>
          <Button size="sm" variant="danger" onClick={() => setDeleting(c)} aria-label={`Xóa ${c.name}`}>Xóa</Button>
        </div>
      ),
    },
  ];

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold">Combo bắp nước</h1>
        <Button onClick={() => setEditing('new')}>+ Thêm combo</Button>
      </div>
      <DataTable caption="Danh sách combo" columns={columns} rows={list.data} loading={list.isPending} error={list.error} onRetry={list.refetch} empty={{ title: 'Chưa có combo' }} />
      {editing && <ComboForm key={editing === 'new' ? 'new' : editing.id} combo={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={Boolean(deleting)} danger title="Xóa combo?" confirmLabel="Xóa" loading={remove.isPending} onConfirm={confirmDelete} onClose={() => setDeleting(null)}>
        Xóa “{deleting?.name}”? Combo đã có trong đơn hàng sẽ không xóa được.
      </ConfirmDialog>
    </section>
  );
}
