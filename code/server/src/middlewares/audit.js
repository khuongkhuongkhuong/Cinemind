import { recordAudit } from '../services/audit.service.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Những giá trị body KHÔNG nhạy cảm, đáng ghi lại ("ai nâng ai lên ADMIN", "ai khóa tài khoản"). Mọi trường khác chỉ ghi TÊN.
const SAFE_VALUE_KEYS = ['role', 'isActive', 'status'];

function describe(req, createdId) {
  const full = `${req.baseUrl}${req.route?.path === '/' ? '' : (req.route?.path ?? '')}`.replace(/^\/api\/v\d+/, '');
  const segments = full.split('/').filter(Boolean); // ["admin", "orders", ":id", "refund"]
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const values = Object.fromEntries(SAFE_VALUE_KEYS.filter((k) => ['string', 'boolean'].includes(typeof body[k])).map((k) => [k, body[k]]));
  return {
    action: `${req.method} ${full}`,
    entityType: segments[1] ?? segments[0] ?? 'unknown',
    entityId: req.params?.id ?? req.params?.code ?? createdId ?? null,
    details: { fields: Object.keys(body), ...(Object.keys(values).length && { values }) },
  };
}

/**
 * Ghi nhật ký cho mọi yêu cầu GHI THÀNH CÔNG (mã 2xx) đi qua router này (FR-39). Đặt SAU requireAuth + requireFreshRole
 * để `req.user.id` là người thật. Quyết định có chủ đích:
 * - Chỉ ghi yêu cầu thành công: thao tác bị từ chối không làm thay đổi dữ liệu.
 * - Mẫu route (`/admin/orders/:id/refund`) và id đối tượng được chụp lúc handler gọi `res.json` (khi `req.route` còn hiệu lực).
 * - Ghi SAU khi trả phản hồi và nuốt lỗi (chỉ log): nhật ký hỏng không được làm hỏng thao tác của admin. Đánh đổi: không
 *   atomic với thay đổi dữ liệu (đã ghi ở docs/04).
 */
export function auditWrites(req, res, next) {
  if (!WRITE_METHODS.has(req.method)) return next();
  let info = null;
  const json = res.json.bind(res);
  res.json = (body) => {
    if (!info) info = describe(req, body?.data?.id);
    return json(body);
  };
  res.on('finish', () => {
    if (!info || res.statusCode < 200 || res.statusCode >= 300 || !req.user?.id) return;
    recordAudit({ actorId: req.user.id, ...info }).catch((err) => console.error('[audit] không ghi được nhật ký:', err));
  });
  next();
}
