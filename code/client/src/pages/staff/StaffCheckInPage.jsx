import { useEffect, useRef, useState } from 'react';
import { useCheckIn, useLookupTicket } from '@/hooks/useTickets';
import { normalizeError, errorMessage } from '@/api/errors';
import { formatDateTime } from '@/lib/format';
import { audioLabel, formatLabel } from '@/lib/movies';
import { checkInReasonText, formatTicketCode, normalizeTicketCode } from '@/lib/tickets';
import AgeBadge from '@/components/ui/AgeBadge';
import Button from '@/components/ui/Button';

function TicketInfo({ order }) {
  const { showtime } = order;
  return (
    <div className="space-y-1 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-bold">{showtime.movie.title}</span>
        <AgeBadge rating={showtime.movie.ageRating} />
      </div>
      <p>{showtime.cinema.name} · {showtime.room.name} · {formatDateTime(showtime.startTime)} · {formatLabel(showtime.format)} {audioLabel(showtime.audio)}</p>
      <p>Ghế: <strong>{order.seats.map((s) => s.label).join(', ')}</strong> ({order.seats.length} ghế)</p>
      <p className="text-ink-300">Mã vé <span className="font-mono">{formatTicketCode(order.code)}</span></p>
      {showtime.movie.ageRating === 'T16' || showtime.movie.ageRating === 'T18' ? (
        <p className="font-semibold text-gold-400">Phim giới hạn độ tuổi {showtime.movie.ageRating}: kiểm tra giấy tờ nếu cần.</p>
      ) : null}
    </div>
  );
}

/**
 * S01 — Soát vé (nhân viên). Nhập hoặc dán mã vé / nội dung QR → Tra cứu → Check-in.
 * Mọi luật (đã thanh toán, đã dùng, khung giờ ±30 phút, suất bị hủy) do SERVER quyết định; trang này chỉ hiển thị kết quả.
 * Check-in là thao tác không hoàn tác được, nên chỉ cho bấm khi server báo `canCheckIn`.
 */
export default function StaffCheckInPage() {
  const [text, setText] = useState('');
  const [result, setResult] = useState(null); // { kind: 'lookup', data } | { kind: 'done', order } | { kind: 'error', message }
  const lookup = useLookupTicket();
  const checkIn = useCheckIn();
  const inputRef = useRef(null);

  useEffect(() => inputRef.current?.focus(), []);

  const code = normalizeTicketCode(text);

  const search = async (e) => {
    e.preventDefault();
    if (!code) return;
    setResult(null);
    lookup.mutate(code, {
      onSuccess: (data) => setResult({ kind: 'lookup', data }),
      onError: (err) => {
        const n = normalizeError(err);
        setResult({ kind: 'error', message: n.code === 'NOT_FOUND' ? 'Không tìm thấy vé với mã này.' : errorMessage(err) });
      },
    });
  };

  const doCheckIn = () => {
    checkIn.mutate(code, {
      onSuccess: (order) => setResult({ kind: 'done', order }),
      onError: (err) => {
        const n = normalizeError(err);
        let message = errorMessage(err);
        if (n.code === 'TICKET_ALREADY_USED') message = n.message; // server ghi rõ "đã được sử dụng lúc HH:mm"
        else if (n.code === 'CHECKIN_NOT_ALLOWED') message = checkInReasonText(n.details?.reason);
        else if (n.code === 'TICKET_NOT_PAID') message = checkInReasonText('NOT_PAID');
        setResult({ kind: 'error', message });
      },
    });
  };

  const next = () => { setText(''); setResult(null); inputRef.current?.focus(); };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-3xl font-black">Soát vé</h1>

      <form onSubmit={search} className="space-y-2">
        <label htmlFor="ticket-code" className="block text-sm font-medium">Mã đặt vé hoặc nội dung mã QR</label>
        <div className="flex gap-2">
          <input
            id="ticket-code" ref={inputRef} value={text} onChange={(e) => { setText(e.target.value); setResult(null); }}
            placeholder="K7Q2-M9XA" autoComplete="off" autoCapitalize="characters" spellCheck={false}
            className="h-12 min-w-0 flex-1 rounded-lg border border-ink-500 bg-ink-800 px-3 font-mono text-lg uppercase tracking-widest placeholder:normal-case placeholder:tracking-normal hover:border-ink-300"
          />
          <Button type="submit" size="lg" loading={lookup.isPending} disabled={!code}>Tra cứu</Button>
        </div>
        <p className="text-xs text-ink-300">Gõ mã (có hoặc không có dấu gạch) hoặc dùng đầu đọc QR để dán vào ô này.</p>
      </form>

      <div aria-live="polite">
        {result?.kind === 'error' && (
          <div role="alert" className="rounded-2xl border border-bad/50 bg-bad/10 p-5">
            <p className="text-xl font-bold text-red-300">❌ Không hợp lệ</p>
            <p className="mt-1">{result.message}</p>
            <Button variant="secondary" className="mt-4" onClick={next}>Vé tiếp theo</Button>
          </div>
        )}

        {result?.kind === 'lookup' && result.data.canCheckIn && (
          <div className="space-y-4 rounded-2xl border border-ok/50 bg-ok/10 p-5">
            <p className="text-xl font-bold text-ok">✅ HỢP LỆ</p>
            <TicketInfo order={result.data.order} />
            <Button size="lg" className="w-full" onClick={doCheckIn} loading={checkIn.isPending}>CHECK-IN</Button>
          </div>
        )}

        {result?.kind === 'lookup' && !result.data.canCheckIn && (
          <div role="alert" className="space-y-3 rounded-2xl border border-bad/50 bg-bad/10 p-5">
            <p className="text-xl font-bold text-red-300">❌ Không cho vào</p>
            <p>{checkInReasonText(result.data.reason)}</p>
            {result.data.order.checkedInAt && <p className="text-sm text-ink-300">Đã quét lúc {formatDateTime(result.data.order.checkedInAt)}.</p>}
            <TicketInfo order={result.data.order} />
            <Button variant="secondary" onClick={next}>Vé tiếp theo</Button>
          </div>
        )}

        {result?.kind === 'done' && (
          <div role="status" className="space-y-4 rounded-2xl border border-ok/50 bg-ok/10 p-5">
            <p className="text-xl font-bold text-ok">✅ Đã check-in</p>
            <TicketInfo order={result.order} />
            <p className="text-sm text-ink-300">Lúc {formatDateTime(result.order.checkedInAt)}</p>
            <Button size="lg" className="w-full" onClick={next}>Vé tiếp theo</Button>
          </div>
        )}
      </div>
    </div>
  );
}
