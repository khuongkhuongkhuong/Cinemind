import { Link } from 'react-router-dom';

/** Chân trang tối (tương phản với nền kem của trang), chữ sáng. */
export default function Footer() {
  return (
    <footer className="mt-16 bg-[#231f20] text-[#c9c5b8]">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 text-sm sm:grid-cols-3">
        <div>
          <div className="text-xl font-extrabold tracking-wide text-white">CINE<span className="text-brand-500">MIND</span></div>
          <p className="mt-2">Đặt vé xem phim nhanh, chọn ghế trực quan, thanh toán an toàn.</p>
        </div>
        <div>
          <div className="font-bold uppercase tracking-wide text-white">Khám phá</div>
          <ul className="mt-2 space-y-1">
            <li><Link to="/movies?status=now" className="hover:text-white">Phim đang chiếu</Link></li>
            <li><Link to="/movies?status=soon" className="hover:text-white">Phim sắp chiếu</Link></li>
            <li><Link to="/cinemas" className="hover:text-white">Hệ thống rạp</Link></li>
          </ul>
        </div>
        <div>
          <div className="font-bold uppercase tracking-wide text-white">Lưu ý</div>
          <p className="mt-2">Ghế được giữ 10 phút kể từ khi bạn chọn. Ngừng bán vé online 15 phút trước giờ chiếu.</p>
        </div>
      </div>
      <div className="border-t border-white/10 py-4 text-center text-xs text-[#9a968a]">
        <p>© {new Date().getFullYear()} Cinemind — đồ án tốt nghiệp.</p>
        <p className="mt-1 px-4">
          Thông tin và hình ảnh phim từ{' '}
          <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer" className="underline hover:text-white">TMDB</a>.
          This product uses the TMDB API but is not endorsed or certified by TMDB.
        </p>
      </div>
    </footer>
  );
}
