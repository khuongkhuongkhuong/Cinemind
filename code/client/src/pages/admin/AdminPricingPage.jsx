import { useState } from 'react';
import { errorMessage, fieldErrors, hasCode } from '@/api/errors';
import { usePricing, useSetPricing } from '@/hooks/useAdmin';
import { pricingToBody, pricingToForm, validatePricing } from '@/lib/adminForms';
import Button from '@/components/ui/Button';
import ErrorState from '@/components/ui/ErrorState';
import Skeleton from '@/components/ui/Skeleton';
import TextField from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';

const FORMATS = [['F2D', '2D'], ['F3D', '3D'], ['IMAX', 'IMAX']];
const DAYS = [['WEEKDAY', 'Thứ 2 – Thứ 5'], ['WEEKEND', 'Thứ 6 – Chủ nhật']]; // khớp BR về ngày cuối tuần ở server
const SEATS = [['STANDARD', 'Ghế thường'], ['VIP', 'Ghế VIP'], ['COUPLE', 'Ghế đôi (mỗi ghế)']];

function PricingForm({ pricing }) {
  const toast = useToast();
  const save = useSetPricing();
  const [form, setForm] = useState(() => pricingToForm(pricing));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const setRule = (k) => (e) => setForm((f) => ({ ...f, rules: { ...f.rules, [k]: e.target.value } }));
  const setSur = (k) => (e) => setForm((f) => ({ ...f, surcharges: { ...f.surcharges, [k]: e.target.value } }));

  const submit = async (e) => {
    e.preventDefault();
    const local = validatePricing(form);
    setErrors(local);
    setFormError('');
    if (Object.keys(local).length) return;
    try {
      await save.mutateAsync(pricingToBody(form));
      toast.success('Đã lưu bảng giá. Suất chiếu tạo SAU này sẽ dùng giá mới; suất đã tạo giữ nguyên giá cũ.');
    } catch (err) {
      if (hasCode(err, 'VALIDATION_ERROR')) setErrors(fieldErrors(err));
      setFormError(errorMessage(err));
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-8">
      {formError && <div role="alert" className="rounded-lg border border-bad/50 bg-bad/10 px-3 py-2 text-sm text-red-200">{formError}</div>}
      <fieldset>
        <legend className="mb-3 text-lg font-semibold">Giá gốc một vé (VND)</legend>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm">
            <thead><tr><th className="p-2 text-left text-ink-300">Định dạng</th>{DAYS.map(([, l]) => <th key={l} className="p-2 text-left text-ink-300">{l}</th>)}</tr></thead>
            <tbody>
              {FORMATS.map(([f, fl]) => (
                <tr key={f}>
                  <th scope="row" className="p-2 text-left font-semibold">{fl}</th>
                  {DAYS.map(([d, dl]) => (
                    <td key={d} className="p-2 align-top">
                      <TextField label={`${fl} – ${dl}`} type="number" min="0" step="1000" value={form.rules[`${f}|${d}`] ?? ''} onChange={setRule(`${f}|${d}`)} error={errors[`rule:${f}|${d}`]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-3 text-lg font-semibold">Phụ thu theo loại ghế (VND)</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          {SEATS.map(([t, l]) => <TextField key={t} label={l} type="number" min="0" step="1000" value={form.surcharges[t] ?? ''} onChange={setSur(t)} error={errors[`sur:${t}`]} />)}
        </div>
      </fieldset>
      <p className="text-sm text-ink-300">Giá vé = giá gốc của suất + phụ thu loại ghế. Giá được chốt vào đơn lúc đặt vé nên đổi bảng giá không ảnh hưởng đơn đã tạo.</p>
      <Button type="submit" loading={save.isPending}>Lưu bảng giá</Button>
    </form>
  );
}

export default function AdminPricingPage() {
  const pricing = usePricing();
  // Form chỉ khởi tạo MỘT lần từ dữ liệu server: nếu dựng lại mỗi lần refetch (vd quay lại tab) thì ô đang gõ dở sẽ bị xóa.
  return (
    <section>
      <h1 className="mb-6 text-2xl font-bold">Bảng giá</h1>
      {pricing.isPending ? <Skeleton className="h-64" /> : pricing.error ? <ErrorState error={pricing.error} onRetry={pricing.refetch} /> : <PricingForm pricing={pricing.data} />}
    </section>
  );
}
