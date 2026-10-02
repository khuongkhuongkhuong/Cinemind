import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { fieldErrors, hasCode, normalizeError, errorMessage } from '@/api/errors';
import { safeReturnUrl } from '@/lib/returnUrl';
import AuthCard from '@/components/layout/AuthCard';
import Button from '@/components/ui/Button';
import TextField from '@/components/ui/TextField';

export default function LoginPage() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnUrl = safeReturnUrl(params.get('returnUrl')); // chỉ nhận đường dẫn nội bộ (chống open redirect)

  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated') return <Navigate to={returnUrl} replace />;

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const local = {};
    if (!form.email.trim()) local.email = 'Vui lòng nhập email';
    if (!form.password) local.password = 'Vui lòng nhập mật khẩu';
    setErrors(local);
    setFormError('');
    if (Object.keys(local).length) return;

    setSubmitting(true);
    try {
      await login({ email: form.email.trim(), password: form.password });
      navigate(returnUrl, { replace: true });
    } catch (err) {
      if (hasCode(err, 'VALIDATION_ERROR')) setErrors(fieldErrors(err));
      else setFormError(errorMessage(err)); // INVALID_CREDENTIALS, ACCOUNT_DISABLED, RATE_LIMITED, mất mạng...
      if (normalizeError(err).code === 'INVALID_CREDENTIALS') setForm((f) => ({ ...f, password: '' }));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthCard
      title="Đăng nhập"
      subtitle="Đăng nhập để đặt vé và xem vé của bạn."
      footer={<>Chưa có tài khoản? <Link to="/register" className="font-semibold text-brand-400 hover:text-brand-500">Đăng ký</Link></>}
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        {formError && <div role="alert" className="rounded-lg border border-bad/50 bg-bad/10 px-3 py-2 text-sm text-red-200">{formError}</div>}
        <TextField label="Email" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={errors.email} autoFocus />
        <TextField label="Mật khẩu" type="password" autoComplete="current-password" value={form.password} onChange={set('password')} error={errors.password} />
        <Button type="submit" size="lg" loading={submitting} className="w-full">Đăng nhập</Button>
      </form>
    </AuthCard>
  );
}
