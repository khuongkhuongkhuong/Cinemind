import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { errorMessage, fieldErrors, hasCode } from '@/api/errors';
import { useForgotPassword, useResetPassword } from '@/hooks/useEmailCode';
import CodeField from '@/components/auth/CodeField';
import AuthCard from '@/components/layout/AuthCard';
import Button from '@/components/ui/Button';
import TextField from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';

/** P16 — Quên mật khẩu: (1) nhập email để xin mã, (2) nhập mã + mật khẩu mới. */
export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const forgot = useForgotPassword();
  const reset = useResetPassword();
  const [step, setStep] = useState('email');
  const [form, setForm] = useState({ email: '', code: '', password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const email = form.email.trim();

  const requestCode = async (e) => {
    e?.preventDefault();
    setFormError('');
    if (!/^\S+@\S+\.\S+$/.test(email)) { setErrors({ email: 'Email không hợp lệ' }); return; }
    setErrors({});
    try {
      await forgot.mutateAsync({ email });
      if (step === 'reset') toast.info('Nếu đủ 60 giây từ lần trước, mã mới đã được gửi');
      setStep('reset');
    } catch (err) {
      if (hasCode(err, 'VALIDATION_ERROR')) setErrors(fieldErrors(err));
      else setFormError(errorMessage(err));
    }
  };

  const submitReset = async (e) => {
    e.preventDefault();
    const local = {};
    if (form.code.length !== 6) local.code = 'Nhập đủ 6 chữ số';
    if (form.password.length < 8) local.newPassword = 'Mật khẩu tối thiểu 8 ký tự';
    else if (form.password.length > 72) local.newPassword = 'Mật khẩu tối đa 72 ký tự';
    if (form.confirm !== form.password) local.confirm = 'Mật khẩu nhập lại không khớp';
    setErrors(local);
    setFormError('');
    if (Object.keys(local).length) return;
    try {
      await reset.mutateAsync({ email, code: form.code, newPassword: form.password });
      toast.success('Đã đổi mật khẩu. Hãy đăng nhập bằng mật khẩu mới.');
      navigate('/login', { replace: true });
    } catch (err) {
      if (hasCode(err, 'VALIDATION_ERROR')) setErrors(fieldErrors(err));
      else setFormError(errorMessage(err));
    }
  };

  const alert = formError && <div role="alert" className="rounded-lg border border-bad/50 bg-bad/10 px-3 py-2 text-sm text-red-200">{formError}</div>;

  return (
    <AuthCard
      title="Quên mật khẩu"
      subtitle={step === 'email'
        ? 'Nhập email đã đăng ký, chúng tôi sẽ gửi mã đặt lại mật khẩu.'
        : `Nếu ${email} đã đăng ký thì mã 6 số đã được gửi tới đó (hết hạn sau 10 phút; nhớ xem cả thư rác).`}
      footer={<Link to="/login" className="font-semibold text-brand-400 hover:text-brand-500">Quay lại đăng nhập</Link>}
    >
      {step === 'email' ? (
        <form onSubmit={requestCode} noValidate className="space-y-4">
          {alert}
          <TextField label="Email" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={errors.email} autoFocus />
          <Button type="submit" size="lg" loading={forgot.isPending} className="w-full">Gửi mã</Button>
        </form>
      ) : (
        <form onSubmit={submitReset} noValidate className="space-y-4">
          {alert}
          <CodeField value={form.code} onChange={(code) => setForm((f) => ({ ...f, code }))} error={errors.code} autoFocus />
          <TextField label="Mật khẩu mới" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} error={errors.newPassword} hint="Tối thiểu 8 ký tự" />
          <TextField label="Nhập lại mật khẩu mới" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} error={errors.confirm} />
          <Button type="submit" size="lg" loading={reset.isPending} className="w-full">Đặt mật khẩu mới</Button>
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setStep('email'); setFormError(''); setErrors({}); }}>← Đổi email</Button>
            <Button variant="ghost" size="sm" onClick={() => requestCode()} loading={forgot.isPending}>Gửi lại mã</Button>
          </div>
        </form>
      )}
    </AuthCard>
  );
}
