// Phân loại độ tuổi (BR-35). Dùng chữ + màu (không chỉ màu) để người mù màu vẫn phân biệt được.
const STYLES = {
  P: ['P', 'border-green-700 bg-green-600 text-white', 'Phù hợp mọi lứa tuổi'],
  K: ['K', 'border-sky-700 bg-sky-600 text-white', 'Trẻ em xem cùng người lớn'],
  T13: ['T13', 'border-amber-600 bg-amber-500 text-white', 'Từ 13 tuổi'],
  T16: ['T16', 'border-orange-700 bg-orange-600 text-white', 'Từ 16 tuổi'],
  T18: ['T18', 'border-red-800 bg-red-600 text-white', 'Từ 18 tuổi'],
};

export default function AgeBadge({ rating, className = '' }) {
  const [text, color, title] = STYLES[rating] ?? [rating, 'bg-ink-700 text-ink-100 border-ink-500', rating];
  return (
    <span title={title} aria-label={title} className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-bold ${color} ${className}`}>
      {text}
    </span>
  );
}
