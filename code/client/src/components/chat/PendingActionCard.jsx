import Button from '@/components/ui/Button';
import { useCountdown } from '@/hooks/useCountdown';

const pad = (n) => String(n).padStart(2, '0');

/**
 * Hộp xác nhận: một việc trợ lý ĐỀ XUẤT (giữ ghế, chọn combo, tạo link thanh toán…). Phần tóm tắt do SERVER sinh từ dữ liệu thật,
 * không phải lời của mô hình. Chỉ khi người dùng bấm "Xác nhận" thì server mới thực thi; hết hạn (5 phút) thì khóa nút.
 */
export default function PendingActionCard({ action, busy, onApprove, onReject }) {
  const remaining = useCountdown(action.expiresAt);
  const expired = remaining <= 0;
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);

  return (
    <section aria-label="Việc đang chờ bạn xác nhận" className="rounded-lg border border-brand-600/40 bg-brand-600/5 p-3 text-sm">
      <p className="font-bold text-ink-100">Cần bạn xác nhận</p>
      <p className="mt-1 text-ink-100">{action.summary}</p>
      <p className="mt-1 text-xs text-ink-300">{expired ? 'Yêu cầu đã hết hạn, hãy nhắn lại để tạo yêu cầu mới.' : `Còn ${minutes}:${pad(seconds)} để xác nhận`}</p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={onApprove} loading={busy} disabled={expired}>Xác nhận</Button>
        <Button size="sm" variant="secondary" onClick={onReject} disabled={busy || expired}>Hủy</Button>
      </div>
    </section>
  );
}
