import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { errorMessage, fieldErrors, hasCode, normalizeError } from '@/api/errors';
import { useAuth } from '@/hooks/useAuth';
import { useResendCode, useVerifyEmail } from '@/hooks/useEmailCode';
import { safeReturnUrl } from '@/lib/returnUrl';
import CodeField from '@/components/auth/CodeField';
import AuthCard from '@/components/layout/AuthCard';
import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

const RESEND_WAIT_S = 60; // khớp thời gian chờ của server (BR-41)

/** P15 — Xác minh email bằng mã 6 số. Xong thì quay lại trang đang làm dở (`returnUrl`). */
export default function VerifyEmailPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const returnUrl = safeReturnUrl(params.get('returnUrl')); // chỉ đường dẫn nội bộ
  const verify = useVerifyEmail();
  const resend = useResendCode();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  if (user?.emailVerified !== false) return <Navigate to={returnUrl} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (code.length !== 6) { setError('Nhập đủ 6 chữ số'); return; }
    try {
      await verify.mutateAsync({ code });
      toast.success('Đã xác minh email');
      navigate(returnUrl, { replace: true });
    } catch (err) {
      setError(hasCode(err, 'VALIDATION_ERROR') ? fieldErrors(err).code ?? errorMessage(err) : errorMessage(err));
      setCode('');
    }
  };

  const sendAgain = async () => {
    setError('');
    try {
      const result = await resend.mutateAsync();
      if (result.alreadyVerified) { navigate(returnUrl, { replace: true }); return; }
      toast.success('Đã gửi mã mới');
      setWait(RESEND_WAIT_S);
    } catch (err) {
      const { code: errorCode, details, message } = normalizeError(err);
      if (errorCode === 'RATE_LIMITED' && details?.retryAfterSec) {
        setWait(Math.min(details.retryAfterSec, 3600));
        setError(message);
      } else setError(errorMessage(err));
    }
  };

  return (
    <AuthCard
      title="Xác minh email"
      subtitle={`Nhập mã 6 số đã gửi tới ${user.email}. Mã hết hạn sau 10 phút; nhớ xem cả thư rác.`}
      footer={<><Link to={returnUrl} className="font-semibold text-brand-400 hover:text-brand-500">Để sau</Link> — chưa xác minh thì chưa đặt vé được.</>}
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <CodeField value={code} onChange={setCode} error={error} autoFocus />
        <Button type="submit" size="lg" loading={verify.isPending} className="w-full">Xác minh</Button>
        <Button variant="secondary" className="w-full" onClick={sendAgain} loading={resend.isPending} disabled={wait > 0}>
          {wait > 0 ? `Gửi lại mã sau ${wait} giây` : 'Gửi lại mã'}
        </Button>
      </form>
    </AuthCard>
  );
}
