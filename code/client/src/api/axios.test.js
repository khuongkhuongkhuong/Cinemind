import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { api } from './axios';
import { getAccessToken, onSessionExpired, setAccessToken } from './tokenStore';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
beforeEach(() => setAccessToken(null));

const ok = (data) => HttpResponse.json({ success: true, data });
const expired = () => HttpResponse.json({ success: false, error: { code: 'TOKEN_EXPIRED', message: 'hết hạn' } }, { status: 401 });

/** Server giả: /private chỉ nhận token "good"; /auth/refresh đếm số lần được gọi. */
function fakeBackend({ refreshOk = true, privateAlwaysExpired = false } = {}) {
  const calls = { refresh: 0, private: 0 };
  server.use(
    http.get('/api/v1/private', ({ request }) => {
      calls.private++;
      if (privateAlwaysExpired || request.headers.get('authorization') !== 'Bearer good') return expired();
      return ok({ secret: 42 });
    }),
    http.post('/api/v1/auth/refresh', async () => {
      calls.refresh++;
      await new Promise((r) => setTimeout(r, 20)); // refresh mất thời gian: các request khác kịp "xếp hàng"
      return refreshOk ? ok({ accessToken: 'good' }) : HttpResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'x' } }, { status: 401 });
    }),
  );
  return calls;
}

describe('Axios + tự refresh token', () => {
  it('gắn access token vào header Authorization', async () => {
    setAccessToken('good');
    const calls = fakeBackend();
    const res = await api.get('/private');
    expect(res.data.data.secret).toBe(42);
    expect(calls.refresh).toBe(0);
  });

  it('gặp 401 TOKEN_EXPIRED: refresh rồi gửi lại request cũ và thành công', async () => {
    setAccessToken('old');
    const calls = fakeBackend();
    const res = await api.get('/private');
    expect(res.data.data.secret).toBe(42);
    expect(calls).toEqual({ refresh: 1, private: 2 }); // lần đầu bị từ chối, lần hai (token mới) thành công
    expect(getAccessToken()).toBe('good');
  });

  it('⭐ nhiều request cùng hết hạn một lúc chỉ gọi refresh MỘT lần (server xoay vòng refresh token)', async () => {
    setAccessToken('old');
    const calls = fakeBackend();
    const results = await Promise.all([api.get('/private'), api.get('/private'), api.get('/private'), api.get('/private')]);
    expect(results.every((r) => r.data.data.secret === 42)).toBe(true);
    expect(calls.refresh).toBe(1);
  });

  it('refresh thất bại: báo hết phiên, xóa token, và request ban đầu bị từ chối với lỗi gốc', async () => {
    setAccessToken('old');
    fakeBackend({ refreshOk: false });
    const onExpired = vi.fn();
    const off = onSessionExpired(onExpired);
    await expect(api.get('/private')).rejects.toMatchObject({ response: { status: 401 } });
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBeNull();
    off();
  });

  it('mỗi request chỉ thử lại đúng một lần (không lặp vô hạn khi server vẫn báo hết hạn)', async () => {
    setAccessToken('old');
    const calls = fakeBackend({ privateAlwaysExpired: true });
    await expect(api.get('/private')).rejects.toMatchObject({ response: { status: 401 } });
    expect(calls).toEqual({ refresh: 1, private: 2 });
  });

  it('lỗi 401 khác (UNAUTHORIZED, INVALID_CREDENTIALS) KHÔNG kích hoạt refresh', async () => {
    let refreshed = 0;
    server.use(
      http.post('/api/v1/auth/login', () => HttpResponse.json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'sai' } }, { status: 401 })),
      http.post('/api/v1/auth/refresh', () => { refreshed++; return ok({ accessToken: 'x' }); }),
    );
    await expect(api.post('/auth/login', {})).rejects.toMatchObject({ response: { status: 401 } });
    expect(refreshed).toBe(0);
  });

  it('lỗi khác 401 (403, 404, 500) được trả nguyên', async () => {
    server.use(http.get('/api/v1/x', () => HttpResponse.json({ success: false, error: { code: 'FORBIDDEN', message: 'no' } }, { status: 403 })));
    await expect(api.get('/x')).rejects.toMatchObject({ response: { status: 403 } });
  });
});
