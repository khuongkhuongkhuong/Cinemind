import TextField from '@/components/ui/TextField';

/** Ô nhập mã 6 số gửi qua email: chỉ nhận chữ số (dán cả "123 456" vẫn được), trình duyệt tự gợi ý mã. */
export default function CodeField({ value, onChange, error, ...props }) {
  return (
    <TextField
      label="Mã 6 số" inputMode="numeric" autoComplete="one-time-code" placeholder="000000" value={value} error={error}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      {...props}
    />
  );
}
