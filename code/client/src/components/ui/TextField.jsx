import { forwardRef, useId } from 'react';

/** Ô nhập có nhãn và thông báo lỗi gắn đúng chuẩn trợ năng (aria-invalid, aria-describedby). */
const TextField = forwardRef(function TextField({ label, error, hint, className = '', id, ...props }, ref) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className={className}>
      <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-ink-100">{label}</label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`h-11 w-full rounded-lg border bg-ink-800 px-3 text-ink-100 placeholder:text-ink-300/60 ${error ? 'border-bad' : 'border-ink-500 hover:border-ink-300'}`}
        {...props}
      />
      {error ? (
        <p id={`${inputId}-error`} className="mt-1 text-sm text-red-300">{error}</p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1 text-xs text-ink-300">{hint}</p>
      ) : null}
    </div>
  );
});
export default TextField;
