/** Trạng thái rỗng: không có dữ liệu để hiển thị. */
export default function EmptyState({ title = 'Chưa có dữ liệu', description, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-ink-600 px-6 py-12 text-center">
      <div className="text-3xl" aria-hidden="true">🎞️</div>
      <p className="text-lg font-semibold text-ink-100">{title}</p>
      {description && <p className="max-w-md text-sm text-ink-300">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
