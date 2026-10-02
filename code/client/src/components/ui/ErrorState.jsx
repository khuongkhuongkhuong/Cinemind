import { errorMessage } from '@/api/errors';
import Button from './Button';

/** Trạng thái lỗi kèm nút thử lại. `error` là lỗi bất kỳ (Axios hoặc Error thường). */
export default function ErrorState({ error, title = 'Không tải được dữ liệu', onRetry }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-2 rounded-xl border border-bad/40 bg-bad/5 px-6 py-10 text-center">
      <div className="text-3xl" aria-hidden="true">⚠️</div>
      <p className="text-lg font-semibold text-ink-100">{title}</p>
      {error && <p className="max-w-md text-sm text-ink-300">{errorMessage(error)}</p>}
      {onRetry && <Button variant="secondary" onClick={onRetry} className="mt-2">Thử lại</Button>}
    </div>
  );
}
