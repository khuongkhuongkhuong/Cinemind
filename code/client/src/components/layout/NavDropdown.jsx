import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';

/** Nội dung menu con. Là component riêng để `useItems` chỉ chạy khi menu đang mở. */
function Menu({ label, useItems, onPick }) {
  const items = useItems();
  return (
    <div className="min-w-52 rounded bg-[#333] p-1.5 shadow-xl">
      <ul aria-label={label} className="rounded-sm border border-white/30 py-1">
        {items.map((item) => (
          <li key={item.to}>
            <Link to={item.to} onClick={onPick} className="block whitespace-nowrap px-4 py-2 text-sm font-bold text-white hover:bg-white/10">
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Mục menu có menu con thả xuống. Bấm vào mục cha vẫn mở trang của nó; rê chuột hoặc Tab tới thì hiện menu con.
 * Đóng khi: rời chuột, đưa tiêu điểm ra ngoài, nhấn Esc, hoặc đã chuyển trang.
 */
export default function NavDropdown({ to, label, useItems, className }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div
      className="relative flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}
      onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
    >
      <NavLink to={to} className={className} aria-expanded={open}>{label}</NavLink>
      {open && (
        // pt-2 nằm TRONG khung bắt chuột: rê từ mục cha xuống menu con không bị đóng giữa chừng.
        <div className="absolute left-0 top-full z-40 pt-2">
          <Menu label={label} useItems={useItems} onPick={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

/** Menu con hiện sẵn, thụt vào dưới mục cha — dùng trong menu ☰ (màn hình cảm ứng không rê chuột được). */
export function MobileSubItems({ useItems }) {
  return useItems().map((i) => (
    <Link key={i.to + i.label} to={i.to} className="py-2 pl-7 pr-3 text-sm text-ink-300 hover:text-brand-600">{i.label}</Link>
  ));
}
