import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useMe } from '@/hooks/useMe';
import { formatMoney } from '@/lib/format';
import { loginUrl } from '@/lib/returnUrl';
import Button from '@/components/ui/Button';

const POINT_UNIT = 10_000; // BR-25: 1 điểm / 10.000đ đã thanh toán (server tính; ở đây chỉ để giải thích)
const CARD = 'rounded-2xl border border-ink-700 bg-ink-900 p-5 sm:p-6';

const STEPS = [
  { title: 'Đăng ký tài khoản', text: 'Miễn phí, chỉ cần email. Có tài khoản là bạn đã là thành viên Cinemind.' },
  { title: 'Đặt vé và thanh toán', text: `Mỗi ${formatMoney(POINT_UNIT)} thực trả (sau khi trừ mã giảm giá) được 1 điểm, phần lẻ không tính.` },
  { title: 'Nhận điểm tự động', text: 'Điểm cộng ngay khi thanh toán thành công. Đơn hủy hoặc hết hạn không được tính.' },
];

/** P14 — Thành viên: điểm hiện có và cách tích điểm. */
export default function MembersPage() {
  const { status, user } = useAuth();
  const { data: me } = useMe({ enabled: Boolean(user) });

  useEffect(() => {
    document.title = 'Thành viên — Cinemind';
    return () => { document.title = 'Cinemind — Đặt vé xem phim'; };
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <h1 className="text-3xl font-black">Thành viên Cinemind</h1>

      {status === 'loading' ? (
        <div className="h-32 animate-pulse rounded-2xl bg-ink-700" aria-busy="true" />
      ) : user ? (
        <section aria-label="Điểm của bạn" className={`${CARD} flex flex-wrap items-center justify-between gap-4`}>
          <div>
            <p className="text-ink-300">Xin chào, <strong className="text-ink-100">{user.fullName}</strong></p>
            <p className="mt-2 text-sm text-ink-300">Điểm hiện có</p>
            <p className="text-4xl font-black text-gold-400" data-testid="points">{me?.points ?? user.points}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/me/tickets"><Button>Vé của tôi</Button></Link>
            <Link to="/me/profile"><Button variant="secondary">Hồ sơ cá nhân</Button></Link>
          </div>
        </section>
      ) : (
        <section aria-label="Tham gia" className={`${CARD} flex flex-wrap items-center justify-between gap-4`}>
          <p>Đăng ký để tích điểm mỗi lần đặt vé.</p>
          <div className="flex flex-wrap gap-2">
            <Link to="/register"><Button>Đăng ký thành viên</Button></Link>
            <Link to={loginUrl('/members')}><Button variant="secondary">Tôi đã có tài khoản</Button></Link>
          </div>
        </section>
      )}

      <section aria-labelledby="how-title" className="space-y-4">
        <h2 id="how-title" className="text-xl font-bold">Cách tích điểm</h2>
        <ol className="grid gap-4 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className={CARD}>
              <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 font-bold text-white">{i + 1}</span>
              <h3 className="mt-3 font-bold">{s.title}</h3>
              <p className="mt-1 text-sm text-ink-300">{s.text}</p>
            </li>
          ))}
        </ol>
        <p className="text-sm text-ink-300">Ví dụ: thanh toán {formatMoney(379_000)} được 37 điểm. Hiện điểm dùng để ghi nhận, chưa đổi được thành ưu đãi.</p>
      </section>
    </div>
  );
}
