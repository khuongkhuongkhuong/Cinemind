import { useState } from 'react';
import { errorMessage, fieldErrors, hasCode } from '@/api/errors';
import { useAdminBanners, useCreateBanner, useDeleteBanner, useUpdateBanner } from '@/hooks/useAdmin';
import { EMPTY_BANNER, bannerToBody, bannerToForm, validateBanner } from '@/lib/adminCatalogForms';
import { formatDateTime } from '@/lib/format';
import DataTable from '@/components/admin/DataTable';
import FormModal, { ConfirmDialog } from '@/components/admin/FormModal';
import Button from '@/components/ui/Button';
import TextField from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';

function BannerForm({ banner, onClose }) {
  const toast = useToast();
  const isCreate = !banner;
  const create = useCreateBanner();
  const update = useUpdateBanner();
  const [form, setForm] = useState(banner ? bannerToForm(banner) : EMPTY_BANNER);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    const local = validateBanner(form);
    setErrors(local);
    setFormError('');
    if (Object.keys(local).length) return;
    try {
      const body = bannerToBody(form);
      if (isCreate) await create.mutateAsync(body); else await update.mutateAsync({ id: banner.id, body });
      toast.success(isCreate ? 'Đã thêm banner' : 'Đã lưu thay đổi');
      onClose();
    } catch (err) {
      if (hasCode(err, 'VALIDATION_ERROR')) setErrors(fieldErrors(err));
      setFormError(errorMessage(err));
    }
  };

  return (
    <FormModal open title={isCreate ? 'Thêm banner' : 'Sửa banner'} onClose={onClose} onSubmit={submit} submitting={create.isPending || update.isPending} error={formError}>
      <TextField label="Tiêu đề" value={form.title} onChange={set('title')} error={errors.title} maxLength={150} />
      <TextField label="URL ảnh" value={form.imageUrl} onChange={set('imageUrl')} error={errors.imageUrl} placeholder="https://… hoặc /banners/a.jpg" />
      <TextField label="Liên kết khi bấm (tùy chọn)" value={form.linkUrl} onChange={set('linkUrl')} error={errors.linkUrl} placeholder="/movies hoặc https://…" />
      <TextField label="Thứ tự hiển thị" type="number" min="0" value={form.sortOrder} onChange={set('sortOrder')} error={errors.sortOrder} hint="Số nhỏ hiện trước." />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Hiện từ (giờ VN, tùy chọn)" type="datetime-local" value={form.start} onChange={set('start')} error={errors.start || errors.startAt} />
        <TextField label="Đến (giờ VN, tùy chọn)" type="datetime-local" value={form.end} onChange={set('end')} error={errors.end || errors.endAt} />
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} /> Đang hiển thị</label>
    </FormModal>
  );
}

export default function AdminBannersPage() {
  const toast = useToast();
  const list = useAdminBanners();
  const remove = useDeleteBanner();
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const confirmDelete = async () => {
    try { await remove.mutateAsync(deleting.id); toast.success('Đã xóa banner'); } catch (err) { toast.error(errorMessage(err)); } finally { setDeleting(null); }
  };

  const columns = [
    { key: 'sortOrder', header: '#', render: (b) => b.sortOrder },
    { key: 'title', header: 'Banner', render: (b) => <div className="max-w-xs"><p className="truncate font-semibold">{b.title}</p><p className="truncate text-xs text-ink-300">{b.imageUrl}</p></div> },
    { key: 'time', header: 'Thời gian', render: (b) => (b.startAt || b.endAt ? <span className="text-xs">{b.startAt ? formatDateTime(b.startAt) : '…'} → {b.endAt ? formatDateTime(b.endAt) : '…'}</span> : 'Luôn hiển thị') },
    { key: 'isActive', header: 'Trạng thái', render: (b) => <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${b.isActive ? 'bg-ok/20 text-green-300' : 'bg-ink-600 text-ink-200'}`}>{b.isActive ? 'Đang hiển thị' : 'Ẩn'}</span> },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (b) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => setEditing(b)} aria-label={`Sửa ${b.title}`}>Sửa</Button>
          <Button size="sm" variant="danger" onClick={() => setDeleting(b)} aria-label={`Xóa ${b.title}`}>Xóa</Button>
        </div>
      ),
    },
  ];

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold">Banner trang chủ</h1>
        <Button onClick={() => setEditing('new')}>+ Thêm banner</Button>
      </div>
      <DataTable caption="Danh sách banner" columns={columns} rows={list.data} loading={list.isPending} error={list.error} onRetry={list.refetch} empty={{ title: 'Chưa có banner' }} />
      {editing && <BannerForm key={editing === 'new' ? 'new' : editing.id} banner={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={Boolean(deleting)} danger title="Xóa banner?" confirmLabel="Xóa" loading={remove.isPending} onConfirm={confirmDelete} onClose={() => setDeleting(null)}>
        Xóa banner “{deleting?.title}”?
      </ConfirmDialog>
    </section>
  );
}
