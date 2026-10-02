import * as auditService from '../../services/audit.service.js';
import { okPaged } from '../../utils/response.js';

export async function list(req, res) {
  const { items, meta } = await auditService.listAuditLogs(req.query);
  okPaged(res, items, meta);
}
