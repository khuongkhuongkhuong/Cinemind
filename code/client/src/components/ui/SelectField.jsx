import { useId } from 'react';

/** Ô chọn có nhãn (nhãn có thể ẩn bằng `hideLabel` nhưng vẫn có cho trình đọc màn hình). */
export default function SelectField({ label, hideLabel = false, children, className = '', ...props }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'mb-1 block text-sm font-medium text-ink-100'}>{label}</label>
      <select id={id} className="h-10 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 text-sm text-ink-100 hover:border-ink-300" {...props}>
        {children}
      </select>
    </div>
  );
}
