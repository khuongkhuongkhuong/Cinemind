import { useState } from 'react';
import { errorMessage, hasCode } from '@/api/errors';
import { useAdminOrder, useAdminOrders, useRefundOrder } from '@/hooks/useAdmin';
import { useDebounce } from '@/hooks/useDebounce';
import { formatDateTime, formatMoney } from '@/lib/format';
import { formatTicketCode, orderStatusInfo } from '@/lib/tickets';
import DataTable from '@/components/admin/DataTable';
import { ConfirmDialog } from '@/components/admin/FormModal';
import Button from '@/components/ui/Button';
import ErrorState from '@/components/ui/ErrorState';
import Modal from '@/components/ui/Modal';
import SelectField from '@/components/ui/SelectField';
import Skeleton from '@/components/ui/Skeleton';
import TextField from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';

const TONE = { ok: 'bg-ok/20 text-green-300', warn: 'bg-warn/20 text-amber-300', muted: 'bg-ink-600 text-ink-200' };
const STATUSES = ['PENDING', 'PAID', 'REFUND_PENDING', 'REFUNDED', 'CANCELLED', 'EXPIRED'];

export const StatusBadge = ({ status }) => {
  const info = orderStatusInfo(status);
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${TONE[info.tone]}`}>{info.label}</span>;
};

function OrderDetail({ orderId, onClose }) {
  const toast = useToast();
  const q = useAdminOrder(orderId);
  const refund = useRefundOrder();
  const [confirming, setConfirming] = useState(false);

  const doRefund = async () => {
    try { await refund.mutateAsync(orderId); toast.success('Đã ghi nhận hoàn tiền'); } catch (err) {
      // ORDER_NOT_PENDING: admin khác vừa xử lý rồi -> tải lại để thấy trạng thái thật.
      toast.error(hasCode(err, 'ORDER_NOT_PENDING') ? 'Đơn này không còn ở trạng thái chờ hoàn tiền (có thể đã được xử lý).' : errorMessage(err));
    } finally { setConfirming(false); }
  };

  const o = q.data;
  return (
    <Modal open onClose={onClose} title={o ? `Đơn ${formatTicketCode(o.code)}` : 'Chi tiết đơn'} wide footer={<Button variant="secondary" onClick={onClose}>Đóng</Button>}>
      {q.isPending ? <Skeleton className="h-48" /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2"><StatusBadge status={o.status} /><span className="text-ink-300">Tạo lúc {formatDateTime(o.createdAt)}</span></div>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <div><dt className="text-ink-300">Khách hàng</dt><dd>{o.user.fullName} · {o.user.email}{o.user.phone ? ` · ${o.user.phone}` : ''}</dd></div>
            <div><dt className="text-ink-300">Phim</dt><dd>{o.showtime.movie.title}</dd></div>
            <div><dt className="text-ink-300">Rạp / phòng</dt><dd>{o.showtime.cinema.name} · {o.showtime.room.name}</dd></div>
            <div><dt className="text-ink-300">Suất chiếu</dt><dd>{formatDateTime(o.showtime.startTime)}</dd></div>
            <div><dt className="text-ink-300">Ghế</dt><dd>{o.seats.map((s) => `${s.label} (${formatMoney(s.price)})`).join(', ')}</dd></div>
            <div><dt className="text-ink-300">Bắp nước</dt><dd>{o.combos.length ? o.combos.map((c) => `${c.name} ×${c.quantity}`).join(', ') : '—'}</dd></div>
            <div><dt className="text-ink-300">Khuyến mãi</dt><dd>{o.promotion ? `${o.promotion.code} (−${formatMoney(o.discount)})` : '—'}</dd></div>
            <div><dt className="text-ink-300">Tổng tiền</dt><dd className="font-bold">{formatMoney(o.total)}</dd></div>
          </dl>
          <div>
            <h3 className="mb-1 font-semibold">Giao dịch thanh toán</h3>
            {o.payments.length === 0 ? <p className="text-ink-300">Chưa có giao dịch.</p> : (
              <ul className="space-y-1">
                {o.payments.map((p) => (
                  <li key={p.id} className="rounded-lg bg-ink-800 px-3 py-2">
                    <span className="font-mono text-xs">{p.txnRef}</span> · {formatMoney(p.amount)} · {p.status}{p.bankCode ? ` · ${p.bankCode}` : ''}{p.providerTxnNo ? ` · VNPay ${p.providerTxnNo}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {o.status === 'REFUND_PENDING' && (
            <div className="rounded-lg border border-warn/50 bg-warn/10 p-3">
              <p className="mb-2">Đơn đang chờ hoàn tiền. Hệ thống <strong>không tự chuyển tiền</strong>: hãy hoàn qua cổng VNPay rồi bấm xác nhận để ghi nhận.</p>
              <Button variant="danger" onClick={() => setConfirming(true)}>Ghi nhận đã hoàn tiền</Button>
            </div>
          )}
        </div>
      )}
      <ConfirmDialog open={confirming} danger title="Ghi nhận đã hoàn tiền?" confirmLabel="Đã hoàn tiền" loading={refund.isPending} onConfirm={doRefund} onClose={() => setConfirming(false)}>
        Chỉ xác nhận khi bạn đã hoàn {o && formatMoney(o.total)} cho khách qua VNPay. Thao tác này không hoàn tác được.
      </ConfirmDialog>
    </Modal>
  );
}

export default function AdminOrdersPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q, 300);
  const [viewing, setViewing] = useState(null);
  const list = useAdminOrders({ page, pageSize: 15, ...(status && { status }), ...(from && { from }), ...(to && { to }), ...(debouncedQ.trim() && { q: debouncedQ.trim() }) });
  const reset = (fn) => (e) => { fn(e.target.value); setPage(1); };

  const columns = [
    { key: 'code', header: 'Mã vé', render: (o) => <span className="font-mono font-semibold">{formatTicketCode(o.code)}</span> },
    { key: 'user', header: 'Khách hàng', render: (o) => <div><p>{o.user.fullName}</p><p className="text-xs text-ink-300">{o.user.email}</p></div> },
    { key: 'movie', header: 'Phim / suất', render: (o) => <div className="max-w-xs"><p className="truncate">{o.showtime.movieTitle}</p><p className="text-xs text-ink-300">{o.showtime.cinemaName} · {formatDateTime(o.showtime.startTime)}</p></div> },
    { key: 'seats', header: 'Ghế', render: (o) => o.seatLabels.join(', ') },
    { key: 'total', header: 'Tổng tiền', render: (o) => formatMoney(o.total) },
    { key: 'status', header: 'Trạng thái', render: (o) => <StatusBadge status={o.status} /> },
    { key: 'actions', header: '', className: 'text-right', render: (o) => <Button size="sm" variant="secondary" onClick={() => setViewing(o.id)} aria-label={`Xem đơn ${formatTicketCode(o.code)}`}>Xem</Button> },
  ];

  return (
    <section>
      <h1 className="mb-6 text-2xl font-bold">Đơn hàng</h1>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <TextField label="Tìm mã vé / email" value={q} onChange={reset(setQ)} className="w-full sm:w-64" />
        <SelectField label="Trạng thái" value={status} onChange={reset(setStatus)} className="w-full sm:w-48">
          <option value="">Tất cả</option>
          {STATUSES.map((s) => <option key={s} value={s}>{orderStatusInfo(s).label}</option>)}
        </SelectField>
        <TextField label="Từ ngày" type="date" value={from} onChange={reset(setFrom)} className="w-full sm:w-44" />
        <TextField label="Đến ngày" type="date" value={to} onChange={reset(setTo)} className="w-full sm:w-44" />
      </div>
      <DataTable
        caption="Danh sách đơn hàng" columns={columns} rows={list.data?.items} loading={list.isPending} error={list.error} onRetry={list.refetch}
        meta={list.data?.meta} onPageChange={setPage} empty={{ title: 'Không có đơn hàng', description: 'Thử đổi bộ lọc.' }}
      />
      {viewing && <OrderDetail orderId={viewing} onClose={() => setViewing(null)} />}
    </section>
  );
}
