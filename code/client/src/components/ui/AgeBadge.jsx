// Phân loại độ tuổi (BR-35). Dùng chữ + màu (không chỉ màu) để người mù màu vẫn phân biệt được.
const STYLES = {
  P: ['P', 'bg-ok/20 text-ok border-ok/50', 'Phù hợp mọi lứa tuổi'],
  K: ['K', 'bg-sky-500/20 text-sky-300 border-sky-400/50', 'Trẻ em xem cùng người lớn'],
  T13: ['T13', 'bg-gold-500/20 text-gold-400 border-gold-400/50', 'Từ 13 tuổi'],
  T16: ['T16', 'bg-orange-500/20 text-orange-300 border-orange-400/50', 'Từ 16 tuổi'],
  T18: ['T18', 'bg-bad/20 text-red-300 border-bad/60', 'Từ 18 tuổi'],
};

export default function AgeBadge({ rating, className = '' }) {
  const [text, color, title] = STYLES[rating] ?? [rating, 'bg-ink-700 text-ink-100 border-ink-500', rating];
  return (
    <span title={title} aria-label={title} className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-bold ${color} ${className}`}>
      {text}
    </span>
  );
}
