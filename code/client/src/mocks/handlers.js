import { HttpResponse, http } from 'msw';
import { cities, genres, movies, user } from './data';

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
];
