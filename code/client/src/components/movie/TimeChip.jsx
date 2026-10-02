import { Link } from 'react-router-dom';
import { formatTime } from '@/lib/format';

/** Một giờ chiếu. Suất đã đóng bán (BR-04: còn < 15 phút hoặc đã chiếu) bị làm mờ và không bấm được. */
export default function TimeChip({ showtime }) {
  const time = formatTime(showtime.startTime);
  if (!showtime.isOpenForSale) {
    return (
      <span title="Đã đóng bán (còn dưới 15 phút hoặc đã chiếu)" aria-label={`${time}, đã đóng bán`}
        className="inline-flex h-10 min-w-16 cursor-not-allowed items-center justify-center rounded-lg border border-ink-700 px-3 text-sm text-ink-500 line-through">
        {time}
      </span>
    );
  }
  return (
    <Link to={`/booking/showtimes/${showtime.id}`} aria-label={`Chọn suất ${time}`}
      className="inline-flex h-10 min-w-16 items-center justify-center rounded-lg border border-ink-500 bg-ink-800 px-3 text-sm font-semibold text-ink-100 hover:border-brand-500 hover:bg-brand-600 hover:text-white">
      {time}
    </Link>
  );
}
