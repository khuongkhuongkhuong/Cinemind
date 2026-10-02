import { forwardRef } from 'react';
import Spinner from './Spinner';

const VARIANTS = {
  primary: 'bg-brand-600 text-white hover:bg-brand-500 active:bg-brand-700 disabled:hover:bg-brand-600',
  secondary: 'bg-ink-900 text-ink-100 hover:bg-ink-800 border border-ink-500',
  ghost: 'text-ink-100 hover:bg-ink-700',
  danger: 'bg-bad/90 text-white hover:bg-bad',
};
const SIZES = { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4 text-sm', lg: 'h-12 px-6 text-base' };

/** Nút bấm. `loading` khóa nút và hiện vòng quay (chống bấm đúp khi đang gửi). */
const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', loading = false, disabled, className = '', children, type = 'button', ...props }, ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
});
export default Button;
