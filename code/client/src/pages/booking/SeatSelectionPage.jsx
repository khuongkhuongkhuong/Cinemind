import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCreateOrder, useSeatMap } from '@/hooks/useBooking';
import { fieldErrors, hasCode, normalizeError, errorMessage } from '@/api/errors';
import { formatDateTime, formatMoney } from '@/lib/format';
import { formatLabel, audioLabel } from '@/lib/movies';
import { MAX_SEATS, dropSeats, estimateTotal, reconcileSelection, selectionLabels, toggleSeat } from '@/lib/seats';
import SeatMap, { SeatLegend } from '@/components/booking/SeatMap';
import AgeBadge from '@/components/ui/AgeBadge';
import Button from '@/components/ui/Button';
import ErrorState from '@/components/ui/ErrorState';
import Modal from '@/components/ui/Modal';
import { PageSpinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { NotFoundPage } from '@/pages/common/StatusPages';

const SELECT_ERRORS = {
  UNAVAILABLE: 'Ghế này đã có người chọn hoặc không còn trống.',
  PAIR_UNAVAILABLE: 'Ghế đôi phải còn trống cả hai ghế mới chọn được.',
  LIMIT: `Mỗi đơn tối đa ${MAX_SEATS} ghế (ghế đôi tính 2).`,
};

/**
 * P05 — Chọn ghế ⭐. Dòng chảy:
 * 1. Sơ đồ tự làm mới mỗi ~12 giây; ghế nào người khác vừa giữ / mua thì bị BỎ khỏi lựa chọn (giữ nguyên các ghế còn hợp lệ).
 * 2. "Tiếp tục" gọi POST /orders. Thành công → trang thanh toán. Ghế vừa bị lấy (SEAT_UNAVAILABLE) → báo, tải lại sơ đồ,
 *    bỏ đúng ghế bị mất, giữ ghế còn lại — người dùng chọn thêm rồi bấm lại, không phải chọn lại từ đầu.
 * Lưu ý: ghế hiển thị "trống" CHƯA chắc giữ được; ai bấm trước thì server (khóa UNIQUE) quyết định.
 */
export default function SeatSelectionPage() {
  const { showtimeId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, isPending, isError, error, refetch } = useSeatMap(showtimeId);
  const createOrder = useCreateOrder();
  const [selected, setSelected] = useState(() => new Set());
  const [closed, setClosed] = useState(false);
  const seen = useRef(null);

  // Mỗi lần có sơ đồ mới: bỏ ghế vừa mất khỏi lựa chọn và báo cho người dùng biết.
  useEffect(() => {
    if (!data || seen.current === data) return;
    seen.current = data;
    setSelected((current) => {
      const { selected: next, lost } = reconcileSelection(current, data.seats);
      if (lost.length) toast.error(`Ghế ${lost.join(', ')} vừa có người khác chọn. Vui lòng chọn ghế khác.`);
      return lost.length ? next : current;
    });
  }, [data, toast]);

  if (isError && (hasCode(error, 'NOT_FOUND') || hasCode(error, 'VALIDATION_ERROR'))) return <NotFoundPage />;
  if (isError) return <ErrorState error={error} onRetry={refetch} />;
  if (isPending) return <PageSpinner label="Đang tải sơ đồ ghế" />;

  const { showtime, seats, rows } = data;
  const open = showtime.isOpenForSale && !closed;
  const labels = selectionLabels(selected, seats);

  const onToggle = (seat) => {
    const result = toggleSeat({ selected, seat, seats });
    if (result.error) toast.error(SELECT_ERRORS[result.error]);
    else setSelected(result.selected);
  };

  const submit = () => {
    createOrder.mutate({ showtimeId, seatIds: [...selected] }, {
      onSuccess: (order) => navigate(`/booking/orders/${order.id}`),
      onError: (err) => {
        const e = normalizeError(err);
        if (e.code === 'SEAT_UNAVAILABLE') {
          setSelected((cur) => dropSeats(cur, e.details?.seatIds ?? [], seats)); // bỏ đúng ghế bị mất, GIỮ ghế còn hợp lệ
          toast.error(e.message);
          refetch(); // vẽ lại sơ đồ với trạng thái mới nhất
        } else if (e.code === 'SHOWTIME_CLOSED') {
          setClosed(true);
        } else if (e.code === 'SEAT_LIMIT_EXCEEDED' || e.code === 'COUPLE_SEAT_INCOMPLETE') {
          toast.error(e.message);
        } else if (e.code === 'VALIDATION_ERROR') {
          toast.error(Object.values(fieldErrors(err))[0] ?? e.message);
        } else {
          toast.error(errorMessage(err));
        }
      },
    });
  };

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-ink-700 bg-ink-900 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-black">{showtime.movie.title}</h1>
          <AgeBadge rating={showtime.movie.ageRating} />
        </div>
        <p className="mt-1 text-ink-300">
          {showtime.cinema.name} · {showtime.room.name} · {formatDateTime(showtime.startTime)} · {formatLabel(showtime.format)} {audioLabel(showtime.audio)}
        </p>
      </header>

      {!open && (
        <p role="alert" className="rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-gold-400">
          Suất chiếu này đã đóng bán (còn dưới 15 phút hoặc đã chiếu). <Link to="/movies" className="font-semibold underline">Chọn suất khác</Link>
        </p>
      )}

      <section aria-label="Chọn ghế" className="rounded-2xl border border-ink-700 bg-ink-900 p-4 sm:p-6">
        <SeatMap seats={seats} rows={rows} selected={selected} onToggle={onToggle} disabled={!open || createOrder.isPending} />
        <div className="mt-6"><SeatLegend /></div>
      </section>

      <div className="sticky bottom-0 -mx-4 border-t border-ink-700 bg-ink-950/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:rounded-2xl sm:border sm:bg-ink-900 sm:p-4">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div aria-live="polite">
            {labels.length ? (
              <>
                <p className="text-sm text-ink-300">Ghế đã chọn ({selected.size}/{MAX_SEATS})</p>
                <p className="font-semibold">{labels.join(', ')}</p>
              </>
            ) : (
              <p className="text-ink-300">Chưa chọn ghế nào. Chọn tối đa {MAX_SEATS} ghế.</p>
            )}
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-xs text-ink-300">Tạm tính</p>
              <p className="text-xl font-black text-gold-400">{formatMoney(estimateTotal(selected, seats))}</p>
            </div>
            <Button size="lg" onClick={submit} loading={createOrder.isPending} disabled={!open || selected.size === 0}>Tiếp tục →</Button>
          </div>
        </div>
      </div>

      <Modal
        open={closed}
        onClose={() => navigate('/movies')}
        dismissible={false}
        title="Suất chiếu đã đóng bán"
        footer={<Button onClick={() => navigate('/movies')}>Chọn phim khác</Button>}
      >
        Suất chiếu này không còn nhận đặt vé online (còn dưới 15 phút trước giờ chiếu). Bạn có thể chọn suất khác.
      </Modal>
    </div>
  );
}
