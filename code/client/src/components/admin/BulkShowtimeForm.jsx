import { useState } from 'react';
import { errorMessage, fieldErrors, hasCode } from '@/api/errors';
import { useBulkShowtimes } from '@/hooks/useAdmin';
import { bulkToBody, EMPTY_BULK, filmEndOf, validateBulk } from '@/lib/showtimePlan';
import { formatDateOnly, formatMoney, formatTime } from '@/lib/format';
import ShowtimeFields from '@/components/admin/ShowtimeFields';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import TextField from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';

const RESULT = {
  OK: () => 'Tạo được',
  PAST: () => 'Giờ đã qua',
  OVERLAP: (c) => `Trùng suất "${c.movieTitle}" ${formatTime(c.startTime)}–${formatTime(filmEndOf(c))} (dọn đến ${formatTime(c.endTime)})`,
  BATCH_OVERLAP: (c) => `Đè lên suất ${formatTime(c.startTime)} trong chính lô này`,
};

/** Tạo nhiều suất một lần (FR-31b): điền -> "Xem trước" -> "Tạo N suất". Đổi ô nào cũng phải xem trước lại. */
export default function BulkShowtimeForm({ initial, onClose }) {
  const toast = useToast();
  const preview = useBulkShowtimes();
  const create = useBulkShowtimes();
  const [form, setForm] = useState({ ...EMPTY_BULK, ...initial });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [result, setResult] = useState(null); // kết quả xem trước của đúng form hiện tại
  const busy = preview.isPending || create.isPending;
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setResult(null); };

  const fail = (err) => {
    if (hasCode(err, 'VALIDATION_ERROR')) setErrors(fieldErrors(err));
    setFormError(errorMessage(err));
  };

  const runPreview = async (e) => {
    e.preventDefault();
    const local = validateBulk(form);
    setErrors(local);
    setFormError('');
    setResult(null);
    if (Object.keys(local).length) return;
    try { setResult(await preview.mutateAsync(bulkToBody(form, true))); } catch (err) { fail(err); }
  };

  const runCreate = async () => {
    setFormError('');
    try {
      const done = await create.mutateAsync(bulkToBody(form, false));
      toast.success(`Đã tạo ${done.okCount} suất chiếu${done.skippedCount ? `, bỏ qua ${done.skippedCount} suất bị trùng hoặc đã qua` : ''}`);
      onClose();
    } catch (err) { fail(err); }
  };

  return (
    <Modal open wide dismissible={!busy} onClose={() => { if (!busy) onClose(); }} title="Tạo suất chiếu hàng loạt">
      <form onSubmit={runPreview} noValidate className="space-y-4">
        {formError && <div role="alert" className="rounded-lg border border-bad/50 bg-bad/10 px-3 py-2 text-sm text-red-200">{formError}</div>}
        <ShowtimeFields form={form} set={set} errors={errors}>
          <div className="grid grid-cols-2 gap-4">
            <TextField label="Từ ngày" type="date" value={form.from} onChange={set('from')} error={errors.from || errors.dates} />
            <TextField label="Đến ngày" type="date" value={form.to} onChange={set('to')} error={errors.to} />
          </div>
          <TextField label="Các giờ chiếu (giờ Việt Nam)" value={form.times} onChange={set('times')} error={errors.times}
            placeholder="09:00, 13:30, 19:00" hint="Cách nhau bằng dấu phẩy hoặc khoảng trắng. Mỗi ngày trong khoảng sẽ có đủ các giờ này." />
        </ShowtimeFields>

        {result && (
          <div className="space-y-2">
            <p className="text-sm font-semibold" role="status">Tạo được {result.okCount} suất{result.skippedCount > 0 && `, bỏ qua ${result.skippedCount}`}.</p>
            <div className="max-h-56 overflow-auto rounded-lg border border-ink-700">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Xem trước các suất sẽ tạo</caption>
                <thead className="sticky top-0 bg-ink-800 text-xs uppercase text-ink-300">
                  <tr><th className="px-3 py-2">Ngày</th><th className="px-3 py-2">Giờ</th><th className="px-3 py-2">Giá gốc</th><th className="px-3 py-2">Kết quả</th></tr>
                </thead>
                <tbody>
                  {result.items.map((i) => (
                    <tr key={`${i.date} ${i.time}`} className="border-t border-ink-700">
                      <td className="px-3 py-1.5">{formatDateOnly(i.date)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5">{i.time}–{formatTime(filmEndOf(i))}</td>
                      <td className="px-3 py-1.5">{formatMoney(i.basePrice)}</td>
                      <td className={`px-3 py-1.5 ${i.result === 'OK' ? 'text-green-300' : 'text-red-300'}`}>{RESULT[i.result](i.conflict)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Đóng</Button>
          <Button type="submit" variant="secondary" loading={preview.isPending} disabled={create.isPending}>Xem trước</Button>
          <Button onClick={runCreate} loading={create.isPending} disabled={!result?.okCount || busy}>
            {result?.okCount ? `Tạo ${result.okCount} suất` : 'Tạo suất'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
