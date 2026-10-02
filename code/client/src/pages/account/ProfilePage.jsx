import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { changePassword, updateProfile } from '@/api/me.api';
import { errorMessage, fieldErrors, hasCode } from '@/api/errors';
import Button from '@/components/ui/Button';
import TextField from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';

const PHONE = /^0\d{9}$/;

/** Kiểm tra phía trình duyệt cho nhanh; server vẫn kiểm tra lại và là nguồn quyết định. */
export const validateProfile = ({ fullName, phone }) => {
  const e = {};
  if (!fullName.trim()) e.fullName = 'Vui lòng nhập họ tên';
  if (phone.trim() && !PHONE.test(phone.trim())) e.phone = 'Số điện thoại gồm 10 chữ số, bắt đầu bằng 0';
  return e;
};
export const validatePassword = ({ current, next, confirm }) => {
  const e = {};
  if (!current) e.current = 'Vui lòng nhập mật khẩu hiện tại';
  if (next.length < 8) e.next = 'Mật khẩu mới tối thiểu 8 ký tự';
  else if (next.length > 72) e.next = 'Mật khẩu mới tối đa 72 ký tự';
  else if (next === current) e.next = 'Mật khẩu mới phải khác mật khẩu hiện tại';
  if (confirm !== next) e.confirm = 'Mật khẩu nhập lại không khớp';
  return e;
};

function ProfileForm({ user, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ fullName: user.fullName, phone: user.phone ?? '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const local = validateProfile(form);
    setErrors(local);
    if (Object.keys(local).length) return;
    setSaving(true);
    try {
      // Chỉ gửi đúng hai trường được phép (server từ chối trường lạ); số điện thoại rỗng = xóa số (null).
      onSaved(await updateProfile({ fullName: form.fullName.trim(), phone: form.phone.trim() || null }));
      toast.success('Đã lưu hồ sơ.');
    } catch (err) {
      if (hasCode(err, 'VALIDATION_ERROR')) setErrors(fieldErrors(err));
      else toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <TextField label="Email" value={user.email} readOnly disabled hint="Email dùng để đăng nhập, không đổi được." />
      <TextField label="Họ và tên" value={form.fullName} onChange={set('fullName')} error={errors.fullName} autoComplete="name" />
      <TextField label="Số điện thoại" type="tel" inputMode="numeric" value={form.phone} onChange={set('phone')} error={errors.phone} autoComplete="tel" hint="Không bắt buộc" />
      <Button type="submit" loading={saving}>Lưu thay đổi</Button>
    </form>
  );
}

function PasswordForm() {
  const toast = useToast();
  const empty = { current: '', next: '', confirm: '' };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const local = validatePassword(form);
    setErrors(local);
    if (Object.keys(local).length) return;
    setSaving(true);
    try {
      await changePassword({ currentPassword: form.current, newPassword: form.next });
      setForm(empty);
      toast.success('Đã đổi mật khẩu. Các thiết bị khác đã bị đăng xuất.');
    } catch (err) {
      // Sai mật khẩu hiện tại là 400 VALIDATION_ERROR (không phải 401, để không bị hiểu nhầm là hết phiên).
      const f = fieldErrors(err);
      if (hasCode(err, 'VALIDATION_ERROR') && (f.currentPassword || f.newPassword)) {
        setErrors({ current: f.currentPassword, next: f.newPassword });
        if (f.currentPassword) setForm((x) => ({ ...x, current: '' }));
      } else {
        toast.error(errorMessage(err));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <TextField label="Mật khẩu hiện tại" type="password" autoComplete="current-password" value={form.current} onChange={set('current')} error={errors.current} />
      <TextField label="Mật khẩu mới" type="password" autoComplete="new-password" value={form.next} onChange={set('next')} error={errors.next} hint="Tối thiểu 8 ký tự" />
      <TextField label="Nhập lại mật khẩu mới" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} error={errors.confirm} />
      <Button type="submit" variant="secondary" loading={saving}>Đổi mật khẩu</Button>
    </form>
  );
}

/** P12 — Hồ sơ cá nhân và đổi mật khẩu. */
export default function ProfilePage() {
  const { user, updateUser } = useAuth();
  return (
    <div className="mx-auto max-w-xl space-y-8">
      <div>
        <h1 className="text-3xl font-black">Hồ sơ cá nhân</h1>
        <p className="mt-1 text-ink-300">Điểm thành viên: <strong className="text-gold-400">{user.points}</strong> (1 điểm / 10.000đ đã thanh toán)</p>
      </div>
      <section aria-labelledby="profile-title" className="rounded-2xl border border-ink-700 bg-ink-900 p-5 sm:p-6">
        <h2 id="profile-title" className="mb-4 text-xl font-bold">Thông tin</h2>
        <ProfileForm user={user} onSaved={updateUser} />
      </section>
      <section aria-labelledby="password-title" className="rounded-2xl border border-ink-700 bg-ink-900 p-5 sm:p-6">
        <h2 id="password-title" className="mb-1 text-xl font-bold">Đổi mật khẩu</h2>
        <p className="mb-4 text-sm text-ink-300">Đổi xong, các thiết bị khác đang đăng nhập sẽ bị đăng xuất.</p>
        <PasswordForm />
      </section>
    </div>
  );
}
