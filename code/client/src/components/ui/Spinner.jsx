/** Vòng quay đang tải. `label` cho trình đọc màn hình. */
export default function Spinner({ className = 'h-6 w-6', label = 'Đang tải' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" role="status" aria-label={label}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Spinner chiếm cả vùng nội dung, dùng khi cả trang đang tải. */
export function PageSpinner({ label }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-ink-300">
      <Spinner className="h-8 w-8" label={label} />
    </div>
  );
}
