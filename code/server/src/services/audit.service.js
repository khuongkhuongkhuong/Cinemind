import { prisma } from '../config/prisma.js';
import { buildMeta, toSkipTake } from '../utils/pagination.js';

/**
 * Ghi một dòng nhật ký thao tác (FR-39). Chỉ THÊM, không có hàm sửa / xóa.
 * `details` chỉ nên chứa tên trường và vài giá trị không nhạy cảm — KHÔNG bao giờ truyền mật khẩu hay nguyên body.
 * @param {{ actorId: string, action: string, entityType: string, entityId?: string|null, details?: object|null }} params actorId lấy từ token
 * @returns {Promise<object>} dòng nhật ký vừa ghi
 */
export function recordAudit({ actorId, action, entityType, entityId = null, details = null }) {
  return prisma.auditLog.create({ data: { actorId, action, entityType, entityId, details: details ?? undefined } });
}

/**
 * Danh sách nhật ký (mới nhất trước) cho trang quản trị.
 * @param {{ actorId?: string, entityType?: string, page: number, pageSize: number }} params
 * @returns {Promise<{ items: Array<{ id: string, createdAt: Date, action: string, entityType: string, entityId: string|null,
 *   actor: { id: string, fullName: string, email: string }|null, details: object|null }>, meta: object }>}
 */
export async function listAuditLogs({ actorId, entityType, page, pageSize }) {
  const where = { ...(actorId && { actorId }), ...(entityType && { entityType }) };
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...toSkipTake({ page, pageSize }),
      include: { actor: { select: { id: true, fullName: true, email: true } } },
    }),
  ]);
  const items = rows.map((r) => ({
    id: r.id, createdAt: r.createdAt, action: r.action, entityType: r.entityType, entityId: r.entityId, actor: r.actor, details: r.details,
  }));
  return { items, meta: buildMeta({ page, pageSize }, total) };
}
