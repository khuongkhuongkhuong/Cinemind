import { createHmac, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

export const ACCESS_TTL = '15m';
const ALG = 'HS256'; // ghim thuật toán ở cả ký và kiểm: không cho token tự chọn thuật toán (alg confusion)
export const REFRESH_TTL_MS = 7 * 24 * 3600_000;

/** Access token (JWT, 15 phút): chỉ chứa id + role, KHÔNG chứa dữ liệu nhạy cảm. */
export function signAccessToken({ id, role }) {
  return jwt.sign({ role }, env.JWT_ACCESS_SECRET, { subject: id, expiresIn: ACCESS_TTL, algorithm: ALG });
}

/** @returns {{ id: string, role: string }} @throws AppError TOKEN_EXPIRED | UNAUTHORIZED */
export function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: [ALG] });
    return { id: payload.sub, role: payload.role };
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw new AppError('TOKEN_EXPIRED');
    throw new AppError('UNAUTHORIZED');
  }
}

/** Refresh token: chuỗi ngẫu nhiên không đoán được (không phải JWT); DB chỉ lưu bản băm. */
export const generateRefreshToken = () => randomBytes(48).toString('base64url');

/** Băm có khóa bí mật (HMAC-SHA256): lộ bảng RefreshToken cũng không dùng được nếu chưa có secret. */
export const hashRefreshToken = (token) => createHmac('sha256', env.JWT_REFRESH_SECRET).update(token).digest('hex');
