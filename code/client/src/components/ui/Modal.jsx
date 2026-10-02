import { useEffect, useRef } from 'react';

/**
 * Hộp thoại dùng phần tử <dialog> gốc của trình duyệt: tự khóa focus bên trong, đóng bằng phím Esc, đọc đúng bởi trình đọc màn hình.
 * `onClose` được gọi khi người dùng đóng (Esc hoặc bấm nền); bên ngoài quyết định `open`.
 */
export default function Modal({ open, onClose, title, children, footer, dismissible = true, wide = false }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="modal-title"
      onCancel={(e) => { e.preventDefault(); if (dismissible) onClose?.(); }} // Esc
      onClick={(e) => { if (dismissible && e.target === ref.current) onClose?.(); }} // bấm nền mờ
      className={`m-auto ${wide ? 'w-[min(44rem,calc(100vw-2rem))]' : 'w-[min(32rem,calc(100vw-2rem))]'} max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl border border-ink-600 bg-ink-800 p-0 text-ink-100 shadow-2xl backdrop:bg-black/70`}
    >
      {open && (
        <div className="p-6">
          <h2 id="modal-title" className="text-lg font-bold">{title}</h2>
          <div className="mt-3 text-sm text-ink-100/90">{children}</div>
          {footer && <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
