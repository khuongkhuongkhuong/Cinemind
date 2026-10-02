/** Dãy trang rút gọn: 1 … 4 5 [6] 7 8 … 20 (luôn có trang đầu, trang cuối, và vài trang quanh trang hiện tại). */
export function pageWindow(page, totalPages, around = 1) {
  const pages = new Set([1, totalPages]);
  for (let p = page - around; p <= page + around; p++) if (p >= 1 && p <= totalPages) pages.add(p);
  const sorted = [...pages].sort((a, b) => a - b);
  const out = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push('gap');
    out.push(p);
  });
  return out;
}

export default function Pagination({ page, totalPages, onChange }) {
  if (!totalPages || totalPages <= 1) return null;
  const btn = 'inline-flex h-10 min-w-10 items-center justify-center rounded-lg border px-3 text-sm font-medium';
  return (
    <nav aria-label="Phân trang" className="mt-8 flex flex-wrap items-center justify-center gap-2">
      <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)}
        className={`${btn} border-ink-600 text-ink-100 hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-40`}>
        ← Trước
      </button>
      {pageWindow(page, totalPages).map((p, i) => (p === 'gap' ? (
        <span key={`gap-${i}`} aria-hidden="true" className="px-1 text-ink-300">…</span>
      ) : (
        <button key={p} type="button" onClick={() => onChange(p)} aria-current={p === page ? 'page' : undefined} aria-label={`Trang ${p}`}
          className={`${btn} ${p === page ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-600 text-ink-100 hover:bg-ink-700'}`}>
          {p}
        </button>
      )))}
      <button type="button" disabled={page >= totalPages} onClick={() => onChange(page + 1)}
        className={`${btn} border-ink-600 text-ink-100 hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-40`}>
        Sau →
      </button>
    </nav>
  );
}
