import { env } from '../config/env.js';
import { REFRESH_TTL_MS } from '../lib/jwt.js';
import * as authService from '../services/auth.service.js';
import { ok } from '../utils/response.js';

const COOKIE_NAME = 'refreshToken';
// httpOnly: JS trên trang không đọc được (chống XSS đánh cắp). path hẹp: chỉ gửi kèm các request /auth.
// sameSite lax: chặn gửi cookie từ trang web lạ (chống CSRF). secure: bắt buộc HTTPS khi production.
const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: env.NODE_ENV === 'production',
  path: '/api/v1/auth',
};

const setRefreshCookie = (res, token) => res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: REFRESH_TTL_MS });

export async function register(req, res) {
  const { refreshToken, ...data } = await authService.register(req.body);
  setRefreshCookie(res, refreshToken);
  ok(res, data, 201);
}

export async function login(req, res) {
  const { refreshToken, ...data } = await authService.login(req.body);
  setRefreshCookie(res, refreshToken);
  ok(res, data);
}

export async function refresh(req, res) {
  const { refreshToken, accessToken } = await authService.refresh({ refreshToken: req.cookies[COOKIE_NAME] });
  setRefreshCookie(res, refreshToken);
  ok(res, { accessToken });
}

export async function logout(req, res) {
  await authService.logout({ refreshToken: req.cookies[COOKIE_NAME] });
  res.clearCookie(COOKIE_NAME, cookieOptions);
  res.status(204).end();
}

export async function me(req, res) {
  ok(res, await authService.getMe({ userId: req.user.id }));
}
