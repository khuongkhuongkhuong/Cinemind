import { useState } from 'react';
import { errorMessage, fieldErrors, hasCode } from '@/api/errors';
import { useAdminPromotions, useCreatePromotion, useDeletePromotion, useUpdatePromotion } from '@/hooks/useAdmin';
import { EMPTY_PROMO, promoToBody, promoToForm, validatePromo } from '@/lib/adminCatalogForms';
import { formatDateTime, formatMoney } from '@/lib/format';
import DataTable from '@/components/admin/DataTable';
import FormModal, { ConfirmDialog } from '@/components/admin/FormModal';
import Button from '@/components/ui/Button';
import SelectField from '@/components/ui/SelectField';
import TextField from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';

const describe = (p) => (p.discountType === 'PERCENT'
  ? `Giảm ${p.discountValue}%${p.maxDiscount ? ` (tối đa ${formatMoney(p.maxDiscount)})` : ''}`
  : `Giảm ${formatMoney(p.discountValue)}`);

function PromoForm({ promo, onClose }) {
  const toast = useToast();
  const isCreate = !promo;
  const create = useCreatePromotion();
  const update = useUpdatePromotion();
  const [form, setForm] = useState(promo ? promoToForm(promo) : EMPTY_PROMO);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    const local = validatePromo(form, isCreate);
    setErrors(local);
    setFormError('');
    if (Object.keys(local).length) return;
    try {
      const body = promoToBody(form, isCreate);
      if (isCreate) await create.mutateAsync(body); else await update.mutateAsync({ id: promo.id, body });
      toast.success(isCreate ? 'Đã tạo mã khuyến mãi' : 'Đã lưu thay đổi');
      onClose();
    } catch (err) {
      if (hasCode(err, 'VALIDATION_ERROR')) setErrors(fieldErrors(err));
      setFormError(errorMessage(err));
    }
  };

  return (
    <FormModal open title={isCreate ? 'Thêm khuyến mãi' : `Sửa ${promo.code}`} onClose={onClose} onSubmit={submit} submitting={create.isPending || update.isPending} error={formError} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        {isCreate
          ? <TextField label="Mã (khách sẽ nhập)" value={form.code} onChange={set('code')} error={errors.code} maxLength={30} hint="Tự viết hoa. Không đổi được sau khi tạo." />
          : <TextField label="Mã" value={form.code} readOnly disabled hint="Mã không đổi được." />}
        <TextField label="Tên chương trình" value={form.name} onChange={set('name')} error={errors.name} maxLength={100} />
        <SelectField label="Loại giảm" value={form.discountType} onChange={set('discountType')}>
          <option value="PERCENT">Phần trăm (%)</option>
          <option value="FIXED">Số tiền cố định (VND)</option>
        </SelectField>
        <TextField label={form.discountType === 'PERCENT' ? 'Giá trị giảm (%)' : 'Giá trị giảm (VND)'} type="number" min="1" value={form.discountValue} onChange={set('discountValue')} error={errors.discountValue} />
        {form.discountType === 'PERCENT' && <TextField label="Giảm tối đa (VND, tùy chọn)" type="number" min="1" value={form.maxDiscount} onChange={set('maxDiscount')} error={errors.maxDiscount} />}
        <TextField label="Đơn tối thiểu (VND)" type="number" min="0" value={form.minOrderValue} onChange={set('minOrderValue')} error={errors.minOrderValue} />
        <TextField label="Bắt đầu (giờ Việt Nam)" type="datetime-local" value={form.start} onChange={set('start')} error={errors.start || errors.startAt} />
        <TextField label="Kết thúc (giờ Việt Nam)" type="datetime-local" value={form.end} onChange={set('end')} error={errors.end || errors.endAt} />
        <TextField label="Giới hạn lượt dùng (tùy chọn)" type="number" min="1" value={form.usageLimit} onChange={set('usageLimit')} error={errors.usageLimit} />
        <label className="flex items-center gap-2 self-end pb-3 text-sm"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} /> Đang áp dụng</label>
        <TextField label="Mô tả" value={form.description} onChange={set('description')} maxLength={300} className="sm:col-span-2" />
      </div>
    </FormModal>
  );
}

export default function AdminPromotionsPage() {
  const toast = useToast();
  const list = useAdminPromotions();
  const remove = useDeletePromotion();
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const confirmDelete = async () => {
    try { await remove.mutateAsync(deleting.id); toast.success('Đã xóa mã'); } catch (err) {
      toast.error(hasCode(err, 'RESOURCE_IN_USE') ? 'Mã đã được dùng trong đơn hàng nên không xóa được. Hãy tắt "Đang áp dụng".' : errorMessage(err));
    } finally { setDeleting(null); }
  };

  const columns = [
    { key: 'code', header: 'Mã', render: (p) => <span className="font-mono font-semibold">{p.code}</span> },
    { key: 'name', header: 'Chương trình', render: (p) => <div className="max-w-xs"><p className="truncate">{p.name}</p><p className="text-xs text-ink-300">{describe(p)}{p.minOrderValue > 0 ? ` · đơn từ ${formatMoney(p.minOrderValue)}` : ''}</p></div> },
    { key: 'time', header: 'Thời gian', render: (p) => <span className="text-xs">{formatDateTime(p.startAt)}<br />→ {formatDateTime(p.endAt)}</span> },
    { key: 'used', header: 'Đã dùng', render: (p) => `${p.usedCount}${p.usageLimit ? ` / ${p.usageLimit}` : ''}` },
    { key: 'isActive', header: 'Trạng thái', render: (p) => <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${p.isActive ? 'bg-ok/20 text-green-300' : 'bg-ink-600 text-ink-200'}`}>{p.isActive ? 'Đang áp dụng' : 'Tắt'}</span> },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (p) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => setEditing(p)} aria-label={`Sửa ${p.code}`}>Sửa</Button>
          <Button size="sm" variant="danger" onClick={() => setDeleting(p)} aria-label={`Xóa ${p.code}`}>Xóa</Button>
        </div>
      ),
    },
  ];

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold">Khuyến mãi</h1>
        <Button onClick={() => setEditing('new')}>+ Thêm khuyến mãi</Button>
      </div>
      <DataTable caption="Danh sách khuyến mãi" columns={columns} rows={list.data} loading={list.isPending} error={list.error} onRetry={list.refetch} empty={{ title: 'Chưa có khuyến mãi' }} />
      {editing && <PromoForm key={editing === 'new' ? 'new' : editing.id} promo={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={Boolean(deleting)} danger title="Xóa mã khuyến mãi?" confirmLabel="Xóa" loading={remove.isPending} onConfirm={confirmDelete} onClose={() => setDeleting(null)}>
        Xóa mã {deleting?.code}? Mã đã được dùng trong đơn sẽ không xóa được.
      </ConfirmDialog>
    </section>
  );
}
