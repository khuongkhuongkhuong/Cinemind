import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { errorMessage, fieldErrors, hasCode } from '@/api/errors';
import AuthCard from '@/components/layout/AuthCard';
import Button from '@/components/ui/Button';
import TextField from '@/components/ui/TextField';

const PHONE = /^0\d{9}$/;

/** Kiểm tra phía trình duyệt cho nhanh; server vẫn kiểm tra lại và là nguồn quyết định. */
export function validateRegister(f) {
  const e = {};
  if (!f.fullName.trim()) e.fullName = 'Vui lòng nhập họ tên';
  if (!f.email.trim()) e.email = 'Vui lòng nhập email';
  else if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) e.email = 'Email không hợp lệ';
  if (f.phone.trim() && !PHONE.test(f.phone.trim())) e.phone = 'Số điện thoại gồm 10 chữ số, bắt đầu bằng 0';
  if (f.password.length < 8) e.password = 'Mật khẩu tối thiểu 8 ký tự';
  else if (f.password.length > 72) e.password = 'Mật khẩu tối đa 72 ký tự';
  if (f.confirm !== f.password) e.confirm = 'Mật khẩu nhập lại không khớp';
  return e;
}

export default function RegisterPage() {
  const { status, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated') return <Navigate to="/" replace />;
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const local = validateRegister(form);
    setErrors(local);
    setFormError('');
    if (Object.keys(local).length) return;

    setSubmitting(true);
    try {
      await register({
        email: form.email.trim(), password: form.password, fullName: form.fullName.trim(),
        ...(form.phone.trim() && { phone: form.phone.trim() }),
      });
      navigate('/', { replace: true });
    } catch (err) {
      if (hasCode(err, 'EMAIL_EXISTS')) setErrors({ email: 'Email này đã được đăng ký' });
      else if (hasCode(err, 'VALIDATION_ERROR')) setErrors(fieldErrors(err));
      else setFormError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthCard
      title="Tạo tài khoản"
      subtitle="Miễn phí, chỉ mất một phút."
      footer={<>Đã có tài khoản? <Link to="/login" className="font-semibold text-brand-400 hover:text-brand-500">Đăng nhập</Link></>}
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        {formError && <div role="alert" className="rounded-lg border border-bad/50 bg-bad/10 px-3 py-2 text-sm text-red-200">{formError}</div>}
        <TextField label="Họ và tên" autoComplete="name" value={form.fullName} onChange={set('fullName')} error={errors.fullName} autoFocus />
        <TextField label="Email" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={errors.email} />
        <TextField label="Số điện thoại (không bắt buộc)" type="tel" autoComplete="tel" inputMode="numeric" value={form.phone} onChange={set('phone')} error={errors.phone} />
        <TextField label="Mật khẩu" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} error={errors.password} hint="Tối thiểu 8 ký tự" />
        <TextField label="Nhập lại mật khẩu" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} error={errors.confirm} />
        <Button type="submit" size="lg" loading={submitting} className="w-full">Đăng ký</Button>
      </form>
    </AuthCard>
  );
}
