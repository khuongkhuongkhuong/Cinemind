import { useState } from 'react';
import { createPortal } from 'react-dom';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { safeExternalUrl, youtubeEmbedUrl } from '@/lib/movies';

const VARIANTS = {
  // Nút chữ ở trang chi tiết phim
  text: {
    className: 'inline-flex h-11 items-center gap-2 rounded-lg border border-ink-500 px-4 text-sm font-semibold hover:bg-ink-700',
    content: '▶ Xem trailer',
  },
  // Nút tròn nằm giữa poster ở thẻ phim
  poster: {
    className: 'flex h-14 w-14 items-center justify-center rounded-full bg-brand-600/90 text-white shadow-lg ring-2 ring-white/80 transition-transform hover:scale-110 hover:bg-brand-500',
    content: <svg aria-hidden="true" viewBox="0 0 24 24" className="ml-1 h-6 w-6 fill-current"><path d="M7 5v14l12-7z" /></svg>,
  },
};

/** Nút "Xem trailer": video YouTube phát ngay trong hộp thoại; link nguồn khác thì mở tab mới. Không có link hợp lệ thì không hiện gì. */
export default function TrailerButton({ url, title, variant = 'text' }) {
  const [open, setOpen] = useState(false);
  const embed = youtubeEmbedUrl(url);
  const external = safeExternalUrl(url);
  const { className, content } = VARIANTS[variant];
  const label = variant === 'poster' ? `Xem trailer phim ${title}` : undefined; // nút chỉ có biểu tượng cần tên đọc được

  if (!external) return null;
  if (!embed) return <a href={external} target="_blank" rel="noopener noreferrer" aria-label={label} className={className}>{content}</a>;

  const close = () => setOpen(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={label} className={className}>{content}</button>
      {/* Đưa hộp thoại ra <body>: không bị ảnh hưởng bởi lớp phủ ẩn / hiện của thẻ phim. Chỉ dựng khi mở, đóng lại là video ngừng phát. */}
      {open && createPortal(
        <Modal open onClose={close} title={`Trailer — ${title}`} size="video"
          footer={<Button variant="secondary" onClick={close}>Đóng</Button>}>
          <iframe src={embed} title={`Trailer phim ${title}`} className="aspect-video w-full rounded-lg bg-black"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
        </Modal>,
        document.body,
      )}
    </>
  );
}
