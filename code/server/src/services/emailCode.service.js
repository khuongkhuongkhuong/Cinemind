import { createHmac, randomInt } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';

// Service phụ trách thực thể EmailCode: cấp và kiểm MÃ 6 SỐ gửi qua email (BR-41). Không gửi thư (auth.service lo).

const TTL_MS = 10 * 60_000; // mã hết hạn sau 10 phút
const COOLDOWN_MS = 60_000; // hai lần cấp mã cách nhau ít nhất 60 giây
const WINDOW_MS = 60 * 60_000;
const MAX_PER_WINDOW = 5; // tối đa 5 mã mỗi giờ: xin mã mới liên tục không cho đoán thêm vô hạn
export const MAX_ATTEMPTS = 5;

/**
 * Chỉ lưu bản băm có KHÓA (HMAC): mã chỉ có 1 triệu khả năng nên băm thường (SHA-256) bị dò ngược ngay nếu lộ database.
 * Băm kèm userId + mục đích để mã của người này / việc này không dùng được cho người khác / việc khác.
 */
const hashCode = ({ userId, purpose, code }) =>
  createHmac('sha256', env.JWT_REFRESH_SECRET).update(`email-code:${userId}:${purpose}:${code}`).digest('hex');

const seconds = (ms) => Math.max(1, Math.ceil(ms / 1000));

/**
 * Cấp mã mới (thay mã cũ cùng mục đích).
 * @param {{ userId: string, purpose: 'VERIFY_EMAIL'|'RESET_PASSWORD', now?: Date }} params
 * @returns {Promise<{ issued: true, code: string } | { issued: false, retryAfterSec: number }>}
 *   `issued: false` khi đang trong 60 giây chờ hoặc đã hết 5 mã trong giờ.
 */
export async function issueCode({ userId, purpose, now = new Date() }) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0'); // sinh ngẫu nhiên an toàn
  const fresh = { codeHash: hashCode({ userId, purpose, code }), expiresAt: new Date(now.getTime() + TTL_MS), attempts: 0, sentAt: now };
  const current = await findCode({ userId, purpose });

  if (!current) {
    try {
      await insertCode({ userId, purpose, ...fresh, sendCount: 1, windowStart: now });
      return { issued: true, code };
    } catch (err) {
      if (err.code !== 'P2002') throw err; // hai yêu cầu cùng lúc: UNIQUE(userId, purpose) chỉ cho một bên tạo
      return { issued: false, retryAfterSec: seconds(COOLDOWN_MS) };
    }
  }

  const cooldown = current.sentAt.getTime() + COOLDOWN_MS - now.getTime();
  if (cooldown > 0) return { issued: false, retryAfterSec: seconds(cooldown) };
  const newWindow = now.getTime() - current.windowStart.getTime() >= WINDOW_MS;
  if (!newWindow && current.sendCount >= MAX_PER_WINDOW) {
    return { issued: false, retryAfterSec: seconds(current.windowStart.getTime() + WINDOW_MS - now.getTime()) };
  }
  const replaced = await replaceCode({
    id: current.id,
    previousSentAt: current.sentAt,
    data: { ...fresh, sendCount: newWindow ? 1 : current.sendCount + 1, windowStart: newWindow ? now : current.windowStart },
  });
  return replaced === 1 ? { issued: true, code } : { issued: false, retryAfterSec: seconds(COOLDOWN_MS) };
}

/**
 * Kiểm mã và DÙNG LUÔN nếu đúng. Mỗi lần gọi tính một lượt nhập, kể cả khi nhiều yêu cầu đến cùng lúc.
 * Đừng gọi trong transaction sẽ rollback khi mã sai: lượt nhập phải được ghi lại.
 * @param {{ userId: string, purpose: 'VERIFY_EMAIL'|'RESET_PASSWORD', code: string, now?: Date }} params
 * @returns {Promise<{ ok: true } | { ok: false, attemptsLeft: number }>} `attemptsLeft = 0`: phải xin mã mới
 */
export async function consumeCode({ userId, purpose, code, now = new Date() }) {
  // (1) Giành MỘT lượt nhập bằng một câu cập nhật có điều kiện: 100 yêu cầu song song vẫn chỉ 5 yêu cầu được so mã.
  if ((await countAttempt({ userId, purpose, now })) !== 1) return { ok: false, attemptsLeft: 0 };
  // (2) Đúng mã thì xóa luôn (dùng một lần): hai yêu cầu đúng mã cùng lúc chỉ một bên xóa được.
  if ((await deleteMatchingCode({ userId, purpose, codeHash: hashCode({ userId, purpose, code }) })) === 1) return { ok: true };
  const current = await findCode({ userId, purpose });
  return { ok: false, attemptsLeft: current ? Math.max(0, MAX_ATTEMPTS - current.attempts) : 0 };
}

/**
 * Bỏ mã còn lại của một mục đích (vd đã xác minh email bằng đường khác).
 * @param {{ userId: string, purpose: 'VERIFY_EMAIL'|'RESET_PASSWORD' }} params
 * @param {object} [db]
 */
export const discardCode = ({ userId, purpose }, db) => deleteCodes({ userId, purpose }, db);

// =============================================================================================
// TRUY VẤN NỘI BỘ (@internal) — bảng EmailCode.
// =============================================================================================

/** @internal */
export const findCode = ({ userId, purpose }, db = prisma) => db.emailCode.findUnique({ where: { userId_purpose: { userId, purpose } } });

/** @internal */
export const insertCode = (data, db = prisma) => db.emailCode.create({ data });

/**
 * Thay mã NẾU chưa ai thay từ lúc đọc (so `sentAt`). @internal
 * @returns {Promise<number>}
 */
export const replaceCode = async ({ id, previousSentAt, data }, db = prisma) =>
  (await db.emailCode.updateMany({ where: { id, sentAt: previousSentAt }, data })).count;

/**
 * Tăng số lượt nhập NẾU mã còn hạn và còn lượt. @internal
 * @returns {Promise<number>}
 */
export const countAttempt = async ({ userId, purpose, now }, db = prisma) =>
  (await db.emailCode.updateMany({
    where: { userId, purpose, expiresAt: { gt: now }, attempts: { lt: MAX_ATTEMPTS } }, data: { attempts: { increment: 1 } },
  })).count;

/** @internal @returns {Promise<number>} */
export const deleteMatchingCode = async ({ userId, purpose, codeHash }, db = prisma) =>
  (await db.emailCode.deleteMany({ where: { userId, purpose, codeHash } })).count;

/** @internal */
export const deleteCodes = ({ userId, purpose }, db = prisma) => db.emailCode.deleteMany({ where: { userId, purpose } });
