import { Link } from 'react-router-dom';

function Page({ code, title, text }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <div className="text-7xl font-black text-ink-600">{code}</div>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="max-w-md text-ink-300">{text}</p>
      <Link to="/" className="mt-2 inline-flex h-11 items-center rounded-lg bg-brand-600 px-5 font-semibold text-white hover:bg-brand-500">Về trang chủ</Link>
    </div>
  );
}

export const NotFoundPage = () => <Page code="404" title="Không tìm thấy trang" text="Đường dẫn bạn truy cập không tồn tại hoặc đã được di chuyển." />;
export const ForbiddenPage = () => <Page code="403" title="Bạn không có quyền truy cập" text="Tài khoản của bạn không được phép xem trang này." />;
