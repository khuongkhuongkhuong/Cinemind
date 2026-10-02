import { useMemo, useState } from 'react';
import { useAdminCinemas, useRoomSeats } from '@/hooks/useAdmin';
import SeatMap, { SeatLegend } from '@/components/booking/SeatMap';
import ErrorState from '@/components/ui/ErrorState';
import Skeleton from '@/components/ui/Skeleton';
import Button from '@/components/ui/Button';

const NOOP = () => {};
const EMPTY = new Set();

/** Sơ đồ vật lý của phòng: chỉ xem. Ghế ngưng dùng (isActive=false) hiển thị như "không sử dụng được". */
function RoomSeats({ roomId }) {
  const q = useRoomSeats(roomId);
  const seats = useMemo(
    () => (q.data?.seats ?? []).map((s) => ({ ...s, status: s.isActive ? 'AVAILABLE' : 'UNAVAILABLE' })),
    [q.data],
  );
  if (q.isPending) return <Skeleton className="h-64" />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const counts = { STANDARD: 0, VIP: 0, COUPLE: 0 };
  seats.forEach((s) => { counts[s.type] += 1; });
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900 p-4">
      <h2 className="mb-1 text-lg font-semibold">{q.data.room.cinema.name} · {q.data.room.name}</h2>
      <p className="mb-4 text-sm text-ink-300">{seats.length} ghế: {counts.STANDARD} thường · {counts.VIP} VIP · {counts.COUPLE} đôi</p>
      <SeatMap seats={seats} rows={q.data.rows} selected={EMPTY} onToggle={NOOP} disabled showPrice={false} />
      <div className="mt-4"><SeatLegend /></div>
    </div>
  );
}

export default function AdminCinemasPage() {
  const cinemas = useAdminCinemas();
  const [roomId, setRoomId] = useState('');

  return (
    <section>
      <h1 className="mb-1 text-2xl font-bold">Rạp & phòng chiếu</h1>
      <p className="mb-6 text-sm text-ink-300">Chỉ xem. Thêm / sửa rạp thuộc nhóm tính năng “Should” chưa làm (xem docs/01-requirements).</p>
      {cinemas.isPending ? <Skeleton className="h-48" /> : cinemas.error ? <ErrorState error={cinemas.error} onRetry={cinemas.refetch} /> : (
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <div className="space-y-4">
            {cinemas.data.map((c) => (
              <div key={c.id} className="rounded-xl border border-ink-700 bg-ink-900 p-4">
                <h2 className="font-semibold">{c.name}</h2>
                <p className="mb-3 text-xs text-ink-300">{c.address} · {c.city.name}</p>
                <div className="flex flex-wrap gap-2">
                  {c.rooms.map((r) => (
                    <Button key={r.id} size="sm" variant={roomId === r.id ? 'primary' : 'secondary'} onClick={() => setRoomId(r.id)} aria-pressed={roomId === r.id}
                      aria-label={`Xem sơ đồ ${c.name} ${r.name}, ${r.seatCount} ghế`}>
                      {r.name} <span className="text-xs opacity-70">({r.seatCount})</span>
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div>{roomId ? <RoomSeats roomId={roomId} /> : <p className="rounded-xl border border-dashed border-ink-600 p-10 text-center text-ink-300">Chọn một phòng để xem sơ đồ ghế.</p>}</div>
        </div>
      )}
    </section>
  );
}
