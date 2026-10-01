import * as reportService from '../../services/report.service.js';
import { ok } from '../../utils/response.js';

export async function revenue(req, res) {
  ok(res, await reportService.getRevenueReport(req.query));
}
