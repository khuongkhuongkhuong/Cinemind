import { Link } from 'react-router-dom';

// Trang trí đầu trang theo chủ đề điện ảnh (nhận diện riêng của Cinemind). Kiểu dáng .film-strip / .ticket nằm ở index.css.

/** Dải phim nhựa có lỗ răng cưa — chỉ để trang trí. */
export const FilmStrip = () => <div aria-hidden="true" className="film-strip" />;

/** Logo: cuộn phim + chữ. */
export function Logo() {
  return (
    <Link to="/" aria-label="Cinemind — trang chủ" className="group flex shrink-0 items-center gap-2">
      <svg aria-hidden="true" viewBox="0 0 48 48" className="h-10 w-10 text-brand-600 transition-transform duration-500 group-hover:rotate-90 lg:h-12 lg:w-12">
        <circle cx="24" cy="24" r="23" className="fill-current" />
        <g className="fill-ink-950">
          <circle cx="24" cy="11" r="6" /><circle cx="36.4" cy="20" r="6" /><circle cx="31.6" cy="34.5" r="6" />
          <circle cx="16.4" cy="34.5" r="6" /><circle cx="11.6" cy="20" r="6" /><circle cx="24" cy="24" r="3" />
        </g>
      </svg>
      <span className="text-2xl font-black tracking-wide text-ink-100 lg:text-3xl">CINE<span className="text-brand-600">MIND</span></span>
    </Link>
  );
}

/** Nút hình tấm vé: đi thẳng tới danh sách phim đang chiếu. */
export function TicketButton() {
  return (
    <Link to="/movies?status=now" className="ticket shrink-0 -rotate-3 transition-transform hover:rotate-0 hover:scale-105">
      <span className="block border-y-2 border-dashed border-white/60 py-1 text-sm font-black uppercase tracking-wide">Mua vé ngay</span>
    </Link>
  );
}
