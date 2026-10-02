import { useState } from 'react';
import { normalizeError, errorMessage } from '@/api/errors';
import { promoReasonMessage } from '@/lib/promo';
import { formatMoney } from '@/lib/format';
import Button from '@/components/ui/Button';

/** Ô nhập mã khuyến mãi (mỗi đơn một mã, BR-23). Lý do từ chối lấy từ `details.reason` của server. */
export default function PromoBox({ promotion, discount, onApply, onRemove, applying, removing, disabled }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!code.trim()) { setError('Vui lòng nhập mã khuyến mãi'); return; }
    setError('');
    try {
      await onApply(code.trim());
      setCode('');
    } catch (err) {
      const e2 = normalizeError(err);
      setError(e2.code === 'PROMO_INVALID' ? promoReasonMessage(e2.details?.reason) : errorMessage(err));
    }
  };

  if (promotion) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-ok/40 bg-ok/10 p-3">
        <p className="text-sm"><span aria-hidden="true">✔ </span>Đã áp dụng <strong>{promotion.code}</strong> — giảm {formatMoney(discount)}</p>
        <Button variant="ghost" size="sm" onClick={onRemove} loading={removing} disabled={disabled}>Gỡ</Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <label htmlFor="promo-code" className="mb-1 block text-sm font-medium">Mã khuyến mãi</label>
      <div className="flex gap-2">
        <input
          id="promo-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoComplete="off" maxLength={30}
          aria-invalid={error ? true : undefined} aria-describedby={error ? 'promo-error' : undefined} placeholder="Nhập mã"
          className={`h-11 min-w-0 flex-1 rounded-lg border bg-ink-800 px-3 uppercase placeholder:normal-case ${error ? 'border-bad' : 'border-ink-500 hover:border-ink-300'}`}
        />
        <Button type="submit" variant="secondary" loading={applying} disabled={disabled}>Áp dụng</Button>
      </div>
      {error && <p id="promo-error" role="alert" className="mt-1 text-sm text-red-300">{error}</p>}
    </form>
  );
}
