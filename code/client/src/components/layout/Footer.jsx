import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="mt-16 border-t border-ink-700 bg-ink-900">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 text-sm text-ink-300 sm:grid-cols-3">
        <div>
          <div className="text-lg font-extrabold text-white">CINE<span className="text-brand-500">MIND</span></div>
          <p className="mt-2">Đặt vé xem phim nhanh, chọn ghế trực quan, thanh toán an toàn.</p>
        </div>
        <div>
          <div className="font-semibold text-ink-100">Khám phá</div>
          <ul className="mt-2 space-y-1">
            <li><Link to="/movies?status=NOW_SHOWING" className="hover:text-white">Phim đang chiếu</Link></li>
            <li><Link to="/movies?status=COMING_SOON" className="hover:text-white">Phim sắp chiếu</Link></li>
          </ul>
        </div>
        <div>
          <div className="font-semibold text-ink-100">Lưu ý</div>
          <p className="mt-2">Ghế được giữ 10 phút kể từ khi bạn chọn. Ngừng bán vé online 15 phút trước giờ chiếu.</p>
        </div>
      </div>
      <div className="border-t border-ink-800 py-4 text-center text-xs text-ink-300">
        © {new Date().getFullYear()} Cinemind — đồ án tốt nghiệp.
      </div>
    </footer>
  );
}
