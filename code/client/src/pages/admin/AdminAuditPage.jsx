import { useState } from 'react';
import { useAuditLogs } from '@/hooks/useAdmin';
import { AUDIT_ENTITY_TYPES, actionLabel, describeDetails } from '@/lib/adminCatalogForms';
import { formatDateTime } from '@/lib/format';
import DataTable from '@/components/admin/DataTable';
import SelectField from '@/components/ui/SelectField';

/** A11 — Nhật ký thao tác: ai làm gì, lúc nào. Chỉ đọc; server chỉ ghi thao tác thành công (docs/04, FR-39). */
export default function AdminAuditPage() {
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState('');
  const list = useAuditLogs({ page, pageSize: 20, ...(entityType && { entityType }) });

  const columns = [
    { key: 'time', header: 'Thời gian', render: (r) => <span className="whitespace-nowrap">{formatDateTime(r.createdAt)}</span> },
    {
      key: 'actor', header: 'Người thực hiện',
      render: (r) => (r.actor
        ? <div><p className="font-semibold">{r.actor.fullName}</p><p className="text-xs text-ink-300">{r.actor.email}</p></div>
        : <span className="text-ink-300">(tài khoản đã xóa)</span>),
    },
    { key: 'action', header: 'Thao tác', render: (r) => <div><p className="font-semibold">{actionLabel(r.action)}</p><p className="font-mono text-xs text-ink-300">{r.action}</p></div> },
    { key: 'entity', header: 'Đối tượng', render: (r) => <div><p>{AUDIT_ENTITY_TYPES[r.entityType] ?? r.entityType}</p>{r.entityId && <p className="font-mono text-xs text-ink-300">{r.entityId.length > 12 ? `${r.entityId.slice(0, 8)}…` : r.entityId}</p>}</div> },
    { key: 'details', header: 'Chi tiết', render: (r) => <span className="text-xs text-ink-300">{describeDetails(r.details)}</span> },
  ];

  return (
    <section>
      <h1 className="mb-1 text-2xl font-bold">Nhật ký thao tác</h1>
      <p className="mb-6 text-sm text-ink-300">Mọi thao tác quản trị và soát vé thành công đều được ghi lại. Nhật ký chỉ xem, không sửa hay xóa được. Mật khẩu và nội dung biểu mẫu không được lưu.</p>
      <div className="mb-4">
        <SelectField label="Đối tượng" value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }} className="w-full sm:w-56">
          <option value="">Tất cả</option>
          {Object.entries(AUDIT_ENTITY_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </SelectField>
      </div>
      <DataTable
        caption="Nhật ký thao tác" columns={columns} rows={list.data?.items} loading={list.isPending} error={list.error} onRetry={list.refetch}
        meta={list.data?.meta} onPageChange={setPage} empty={{ title: 'Chưa có thao tác nào được ghi lại' }}
      />
    </section>
  );
}
