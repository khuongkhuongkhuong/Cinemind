import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import Pagination from '@/components/ui/Pagination';
import Skeleton from '@/components/ui/Skeleton';

/**
 * Bảng dữ liệu dùng chung cho mọi trang quản trị: tự lo 3 trạng thái (đang tải / rỗng / lỗi), phân trang và cuộn ngang trên điện thoại.
 * @param {{
 *   columns: Array<{ key: string, header: string, render?: (row: object) => any, className?: string }>,
 *   rows?: object[], rowKey?: (row: object) => string,
 *   loading?: boolean, error?: unknown, onRetry?: () => void,
 *   empty?: { title?: string, description?: string, action?: any },
 *   meta?: { page: number, totalPages: number }, onPageChange?: (page: number) => void, caption?: string
 * }} props
 */
export default function DataTable({ columns, rows, rowKey = (r) => r.id, loading, error, onRetry, empty, meta, onPageChange, caption }) {
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (loading) return <div className="space-y-2" aria-busy="true">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>;
  if (!rows?.length) return <EmptyState title={empty?.title ?? 'Chưa có dữ liệu'} description={empty?.description} action={empty?.action} />;

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-ink-700">
        <table className="w-full min-w-max text-left text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="bg-ink-800 text-xs uppercase tracking-wide text-ink-300">
            <tr>{columns.map((c) => <th key={c.key} scope="col" className={`px-4 py-3 font-semibold ${c.className ?? ''}`}>{c.header}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-ink-700 bg-ink-900">
            {rows.map((row) => (
              <tr key={rowKey(row)} className="hover:bg-ink-800/60">
                {columns.map((c) => <td key={c.key} className={`px-4 py-3 align-middle ${c.className ?? ''}`}>{c.render ? c.render(row) : row[c.key]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {meta && onPageChange && <Pagination page={meta.page} totalPages={meta.totalPages} onChange={onPageChange} />}
    </div>
  );
}
