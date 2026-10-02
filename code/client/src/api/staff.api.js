import { api } from './axios';

const unwrap = (promise) => promise.then((res) => res.data.data);

/** Tra cứu vé: { order, canCheckIn, reason? } với reason ∈ NOT_PAID | ALREADY_USED | TOO_EARLY | TOO_LATE | SHOWTIME_CANCELLED. */
export const lookupTicket = (code) => unwrap(api.get(`/staff/tickets/${encodeURIComponent(code)}`));

/** Check-in cả đơn (BR-33). Lỗi: TICKET_ALREADY_USED, TICKET_NOT_PAID, CHECKIN_NOT_ALLOWED (details.reason). */
export const checkIn = (code) => unwrap(api.post(`/staff/tickets/${encodeURIComponent(code)}/check-in`));
