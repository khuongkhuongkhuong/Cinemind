import { HttpResponse, http } from 'msw';
import { cities, genres, movieDetail, movies, schedule, user } from './data';

const BASE = '/api/v1';
const ok = (data, meta) => HttpResponse.json({ success: true, data, ...(meta && { meta }) });
const fail = (status, code, message, details) => HttpResponse.json({ success: false, error: { code, message, ...(details && { details }) } }, { status });

// Mật khẩu của tài khoản giả: "mock-12345" (chỉ dùng với MSW).
export const handlers = [
  http.get(`${BASE}/movies`, ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const items = movies.filter((m) => (!status || m.status === status) && m.title.toLowerCase().includes(q));
    return ok(items, { page: 1, pageSize: 20, total: items.length, totalPages: 1 });
  }),
  http.get(`${BASE}/movies/:slug`, ({ params }) => {
    const m = movies.find((x) => x.slug === params.slug);
    return m ? ok(movieDetail(m)) : fail(404, 'NOT_FOUND', 'Không tìm thấy phim.');
  }),
  http.get(`${BASE}/movies/:movieId/showtimes`, ({ request }) => ok(schedule(new URL(request.url).searchParams.get('date')))),
  http.get(`${BASE}/genres`, () => ok(genres)),
  http.get(`${BASE}/cities`, () => ok(cities)),
  http.get(`${BASE}/banners`, () => ok([])),

  http.post(`${BASE}/auth/login`, async ({ request }) => {
    const { email, password } = await request.json();
    if (email !== user.email || password !== 'mock-12345') return fail(401, 'INVALID_CREDENTIALS', 'Email hoặc mật khẩu không đúng.');
    return ok({ user, accessToken: 'mock-access-token' });
  }),
  http.post(`${BASE}/auth/refresh`, () => fail(401, 'UNAUTHORIZED', 'Bạn cần đăng nhập.')),
  http.post(`${BASE}/auth/logout`, () => new HttpResponse(null, { status: 204 })),
  http.get(`${BASE}/auth/me`, ({ request }) =>
    request.headers.get('authorization') === 'Bearer mock-access-token' ? ok(user) : fail(401, 'UNAUTHORIZED', 'Bạn cần đăng nhập.')),

  // ----- Trợ lý AI giả (chỉ để xem giao diện khi chưa có khóa API; MSW không phải LLM) -----
  http.post(`${BASE}/ai/chat`, async ({ request }) => {
    const { text, sessionId } = await request.json();
    const wantsHold = /giữ|đặt/i.test(text);
    return ok({
      sessionId: sessionId ?? 'mock-session',
      reply: wantsHold
        ? {
          text: 'Mình chuẩn bị giữ ghế G7, G8 cho suất 19:45. Bạn xác nhận nhé?',
          pendingAction: {
            actionId: 'mock-action', tool: 'hold_seats', expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
            summary: 'Giữ ghế G7, G8 (VIP) — Vùng Tối, Cinemind Cầu Giấy, Phòng 2, 19:45. Tổng: 210.000đ. Ghế được giữ 10 phút.',
          },
        }
        : { text: 'Mình có thể tìm suất chiếu, gợi ý ghế liền nhau và giữ ghế giúp bạn. Bạn muốn xem phim nào?', pendingAction: null },
    });
  }),
  http.post(`${BASE}/ai/confirm`, async ({ request }) => {
    const { approve } = await request.json();
    if (!approve) return ok({ reply: { text: 'Mình đã hủy yêu cầu đó. Bạn cần mình giúp gì tiếp không?' } });
    return ok({
      reply: {
        text: 'Đã giữ ghế G7, G8. Bạn thanh toán trong 10 phút nhé.',
        order: {
          id: 'mock-order', code: 'K7Q2M9XA', status: 'PENDING', expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
          showtime: { id: 'st', startTime: new Date(Date.now() + 86_400_000).toISOString(), format: 'F2D', audio: 'SUBTITLE', movie: { title: 'Vùng Tối' }, cinema: { name: 'Cinemind Cầu Giấy' }, room: { name: 'Phòng 2' } },
          seats: [{ seatId: 'g7', label: 'G7', type: 'VIP', price: 105_000 }, { seatId: 'g8', label: 'G8', type: 'VIP', price: 105_000 }],
          combos: [], promotion: null, seatTotal: 210_000, comboTotal: 0, discount: 0, total: 210_000, paidAt: null, checkedInAt: null,
        },
      },
    });
  }),
  http.get(`${BASE}/ai/sessions/:id`, () => fail(404, 'NOT_FOUND', 'Không tìm thấy phiên.')),
  http.delete(`${BASE}/ai/sessions/:id`, ({ params }) => ok({ sessionId: params.id, status: 'CLOSED' })),
];
