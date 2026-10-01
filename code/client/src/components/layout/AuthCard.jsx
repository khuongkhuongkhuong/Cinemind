/** Khung thẻ ở giữa trang cho Đăng nhập / Đăng ký. */
export default function AuthCard({ title, subtitle, children, footer }) {
  return (
    <div className="mx-auto w-full max-w-md py-6">
      <div className="rounded-2xl border border-ink-600 bg-ink-800 p-6 sm:p-8">
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-300">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
      {footer && <p className="mt-4 text-center text-sm text-ink-300">{footer}</p>}
    </div>
  );
}
