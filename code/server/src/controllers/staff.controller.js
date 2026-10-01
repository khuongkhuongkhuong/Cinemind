import * as ticketService from '../services/ticket.service.js';
import { ok } from '../utils/response.js';

export async function lookup(req, res) {
  ok(res, await ticketService.lookupTicket({ code: req.params.code }));
}

// staffId lấy từ token (req.user), không từ body.
export async function checkIn(req, res) {
  ok(res, await ticketService.checkIn({ code: req.params.code, staffId: req.user.id }));
}
