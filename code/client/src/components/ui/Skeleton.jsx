/** Khối xám nhấp nháy giữ chỗ trong lúc tải (đỡ giật bố cục hơn vòng quay). */
export default function Skeleton({ className = '' }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-lg bg-ink-700 ${className}`} />;
}
