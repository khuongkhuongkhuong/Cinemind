import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';

/**
 * Hộp thoại chứa một biểu mẫu (thêm / sửa). Trang cha lo dữ liệu và việc gửi; thành phần này lo khung:
 * tiêu đề, nút Hủy / Lưu (khóa khi đang gửi để chống bấm đúp), và một khung báo lỗi chung (lỗi không thuộc ô nào, vd 409).
 * Không đóng được khi đang gửi để người dùng không mất dữ liệu giữa chừng.
 */
export default function FormModal({ open, title, onClose, onSubmit, submitting, error, submitLabel = 'Lưu', children, wide }) {
  return (
    <Modal
      open={open}
      onClose={() => { if (!submitting) onClose(); }}
      dismissible={!submitting}
      title={title}
      footer={null}
      wide={wide}
    >
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} noValidate className="space-y-4">
        {error && <div role="alert" className="rounded-lg border border-bad/50 bg-bad/10 px-3 py-2 text-sm text-red-200">{error}</div>}
        {children}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>Hủy</Button>
          <Button type="submit" loading={submitting}>{submitLabel}</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Hộp thoại xác nhận cho thao tác khó hoàn tác (xóa, hủy suất, hoàn tiền). */
export function ConfirmDialog({ open, title, children, confirmLabel = 'Xác nhận', danger, loading, onConfirm, onClose }) {
  return (
    <Modal
      open={open}
      onClose={() => { if (!loading) onClose(); }}
      title={title}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>Không</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
        </>
      )}
    >
      {children}
    </Modal>
  );
}
