import { useState } from 'react';
import { errorMessage, fieldErrors, hasCode } from '@/api/errors';
import { useAdminUsers, useCreateStaff, useUpdateUser } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import { useDebounce } from '@/hooks/useDebounce';
import { EMPTY_STAFF, staffToBody, validateStaff } from '@/lib/adminCatalogForms';
import { formatDate } from '@/lib/format';
import DataTable from '@/components/admin/DataTable';
import FormModal, { ConfirmDialog } from '@/components/admin/FormModal';
import Button from '@/components/ui/Button';
import SelectField from '@/components/ui/SelectField';
import TextField from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';

const ROLES = { USER: 'Khách hàng', STAFF: 'Nhân viên', ADMIN: 'Quản trị viên' };

function StaffForm({ onClose }) {
  const toast = useToast();
  const create = useCreateStaff();
  const [form, setForm] = useState(EMPTY_STAFF);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    const local = validateStaff(form);
    setErrors(local);
    setFormError('');
    if (Object.keys(local).length) return;
    try {
      await create.mutateAsync(staffToBody(form));
      toast.success('Đã tạo tài khoản nhân viên');
      onClose();
    } catch (err) {
      if (hasCode(err, 'EMAIL_EXISTS')) setErrors({ email: 'Email này đã được đăng ký' });
      else if (hasCode(err, 'VALIDATION_ERROR')) setErrors(fieldErrors(err));
      setFormError(hasCode(err, 'EMAIL_EXISTS') ? '' : errorMessage(err));
    }
  };

  return (
    <FormModal open title="Thêm nhân viên soát vé" onClose={onClose} onSubmit={submit} submitting={create.isPending} error={formError}>
      <TextField label="Họ tên" value={form.fullName} onChange={set('fullName')} error={errors.fullName} maxLength={100} />
      <TextField label="Email" type="email" value={form.email} onChange={set('email')} error={errors.email} autoComplete="off" />
      <TextField label="Số điện thoại (tùy chọn)" value={form.phone} onChange={set('phone')} error={errors.phone} inputMode="numeric" />
      <TextField label="Mật khẩu tạm" type="password" value={form.password} onChange={set('password')} error={errors.password} autoComplete="new-password" hint="Tối thiểu 8 ký tự. Hãy gửi riêng cho nhân viên và nhắc đổi mật khẩu." />
    </FormModal>
  );
}

export default function AdminUsersPage() {
  const toast = useToast();
  const { user: me } = useAuth();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const debouncedQ = useDebounce(q, 300);
  const list = useAdminUsers({ page, pageSize: 15, ...(debouncedQ.trim() && { q: debouncedQ.trim() }), ...(role && { role }) });
  const update = useUpdateUser();
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState(null); // { user, body, text } đang chờ xác nhận

  const apply = async () => {
    try { await update.mutateAsync({ id: pending.user.id, body: pending.body }); toast.success('Đã cập nhật tài khoản'); } catch (err) {
      // FORBIDDEN (tự khóa / tự hạ quyền, hoặc người cuối cùng là admin): message của server đã giải thích đủ.
      toast.error(errorMessage(err));
    } finally { setPending(null); }
  };
  const askRole = (u, next) => setPending({ user: u, body: { role: next }, text: `Đổi vai trò của ${u.fullName} từ “${ROLES[u.role]}” sang “${ROLES[next]}”?${next === 'ADMIN' ? ' Quản trị viên có toàn quyền hệ thống.' : ''}` });
  const askLock = (u) => setPending({ user: u, body: { isActive: !u.isActive }, text: u.isActive ? `Khóa tài khoản ${u.email}? Người này bị đăng xuất khỏi mọi thiết bị và không đăng nhập lại được.` : `Mở khóa tài khoản ${u.email}?` });

  const columns = [
    { key: 'user', header: 'Người dùng', render: (u) => <div><p className="font-semibold">{u.fullName}{u.id === me?.id && <span className="ml-2 text-xs text-ink-300">(bạn)</span>}</p><p className="text-xs text-ink-300">{u.email}{u.phone ? ` · ${u.phone}` : ''}</p></div> },
    {
      key: 'role', header: 'Vai trò',
      render: (u) => (
        <SelectField label={`Vai trò của ${u.email}`} hideLabel value={u.role} disabled={u.id === me?.id || update.isPending} onChange={(e) => askRole(u, e.target.value)}>
          {Object.entries(ROLES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </SelectField>
      ),
    },
    { key: 'points', header: 'Điểm', render: (u) => u.points },
    { key: 'createdAt', header: 'Tham gia', render: (u) => formatDate(u.createdAt) },
    { key: 'isActive', header: 'Trạng thái', render: (u) => <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${u.isActive ? 'bg-ok/20 text-green-300' : 'bg-bad/20 text-red-300'}`}>{u.isActive ? 'Hoạt động' : 'Đã khóa'}</span> },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (u) => u.id !== me?.id && (
        <Button size="sm" variant={u.isActive ? 'danger' : 'secondary'} onClick={() => askLock(u)} aria-label={`${u.isActive ? 'Khóa' : 'Mở khóa'} ${u.email}`}>{u.isActive ? 'Khóa' : 'Mở khóa'}</Button>
      ),
    },
  ];

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold">Người dùng</h1>
        <Button onClick={() => setAdding(true)}>+ Thêm nhân viên</Button>
      </div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <TextField label="Tìm theo email / họ tên" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="w-full sm:w-72" />
        <SelectField label="Vai trò" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} className="w-full sm:w-48">
          <option value="">Tất cả</option>
          {Object.entries(ROLES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </SelectField>
      </div>
      <DataTable caption="Danh sách người dùng" columns={columns} rows={list.data?.items} loading={list.isPending} error={list.error} onRetry={list.refetch}
        meta={list.data?.meta} onPageChange={setPage} empty={{ title: 'Không có người dùng', description: 'Thử đổi bộ lọc.' }} />
      {adding && <StaffForm onClose={() => setAdding(false)} />}
      <ConfirmDialog open={Boolean(pending)} danger title="Xác nhận thay đổi tài khoản" confirmLabel="Xác nhận" loading={update.isPending} onConfirm={apply} onClose={() => setPending(null)}>
        {pending?.text}
      </ConfirmDialog>
    </section>
  );
}
