import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { getLlm } from '../ai/llm/index.js';
import { runAgentTurn } from '../ai/agent.js';
import { getTool } from '../ai/tools.js';
import { buildSystemPrompt } from '../ai/prompt.js';
import { getOrder } from './booking.service.js';

/**
 * Trợ lý AI đặt vé — phần lưu trữ và điều phối (docs/07). Đây là chỗ DUY NHẤT đụng ChatSession / ChatMessage;
 * thư mục `ai/` không import Prisma. Mọi hàm nhận `userId` từ token (không bao giờ từ nội dung tin nhắn).
 */

export const MAX_TEXT_LENGTH = 1000;
export const HISTORY_LIMIT = 20; // số tin gần nhất gửi cho LLM
export const RATE_PER_MINUTE = 20;
export const RATE_PER_DAY = 200;

const PROMO_REASONS = {
  NOT_FOUND: 'Mã này không tồn tại.',
  NOT_STARTED: 'Mã này chưa đến thời gian áp dụng.',
  EXPIRED: 'Mã này đã hết hạn.',
  USAGE_LIMIT_REACHED: 'Mã này đã hết lượt sử dụng.',
  MIN_ORDER_NOT_MET: 'Đơn của bạn chưa đạt giá trị tối thiểu để dùng mã này.',
  ALREADY_USED: 'Bạn đã dùng mã này rồi.',
};

// ------------------------------------------------------------------ giới hạn tần suất (trong bộ nhớ, theo tài khoản) ------------------------------------------------------------------

const usage = new Map(); // userId -> [mốc thời gian (ms) của các tin trong 24 giờ gần nhất]

/** @throws {AppError} RATE_LIMITED khi quá 20 tin / phút hoặc 200 tin / ngày */
function checkRateLimit(userId, nowMs) {
  const stamps = (usage.get(userId) ?? []).filter((t) => nowMs - t < 24 * 3600_000);
  if (stamps.filter((t) => nowMs - t < 60_000).length >= RATE_PER_MINUTE || stamps.length >= RATE_PER_DAY) {
    usage.set(userId, stamps);
    throw new AppError('RATE_LIMITED', { message: 'Bạn nhắn quá nhanh, vui lòng thử lại sau ít phút.' });
  }
  stamps.push(nowMs);
  usage.set(userId, stamps);
}

/** Chỉ dùng trong test. */
export function resetChatRateLimits() {
  usage.clear();
}

// ------------------------------------------------------------------ tiện ích ------------------------------------------------------------------

const fieldError = (field, message) => new AppError('VALIDATION_ERROR', { details: { fields: { [field]: message } } });
const readState = (session) => (session.state && typeof session.state === 'object' ? session.state : {});
const publicPending = (p) => (p ? { actionId: p.actionId, tool: p.tool, summary: p.summary, expiresAt: p.expiresAt } : null);

/** Phiên của CHÍNH người dùng. @throws {AppError} NOT_FOUND (không có / đã đóng) | FORBIDDEN (của người khác) */
async function loadOwnedSession({ sessionId, userId }) {
  const session = await prisma.chatSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new AppError('NOT_FOUND', { message: 'Không tìm thấy phiên trò chuyện.' });
  if (session.userId !== userId) throw new AppError('FORBIDDEN');
  if (session.status !== 'ACTIVE') throw new AppError('NOT_FOUND', { message: 'Phiên trò chuyện này đã đóng.' });
  return session;
}

/** Hàng ChatMessage -> tin theo giao diện LLM (xem ai/llm/index.js). */
function toLlmMessages(rows) {
  const messages = rows.map((r) => {
    if (r.role === 'USER') return { role: 'user', content: r.content };
    if (r.role === 'ASSISTANT') return { role: 'assistant', content: r.content, ...(r.toolInput?.calls && { toolCalls: r.toolInput.calls }) };
    return { role: 'tool', toolCallId: r.toolInput?.callId, name: r.toolName, content: r.content };
  });
  // Cắt theo số lượng có thể làm "mồ côi" một kết quả tool (mất lời gọi đi kèm) — LLM sẽ từ chối. Bỏ đến tin khách đầu tiên.
  const firstUser = messages.findIndex((m) => m.role === 'user');
  return firstUser < 0 ? [] : messages.slice(firstUser);
}

/** Tin phát sinh trong lượt Agent -> dữ liệu hàng ChatMessage. */
function toRow(m, sessionId, createdAt) {
  if (m.role === 'user') return { sessionId, role: 'USER', content: m.content, createdAt };
  if (m.role === 'assistant') {
    return {
      sessionId, role: 'ASSISTANT', content: m.content, createdAt,
      ...(m.toolCalls?.length && { toolName: m.toolCalls[0].name, toolInput: { calls: m.toolCalls } }),
    };
  }
  let output; try { output = JSON.parse(m.content); } catch { output = { truncated: true }; }
  return { sessionId, role: 'TOOL', content: m.content, toolName: m.name, toolInput: { callId: m.toolCallId }, toolOutput: output, createdAt };
}

/** Đơn đang giữ của phiên (nếu còn) để đưa vào system prompt — dữ liệu do HỆ THỐNG đọc từ DB, không phải do LLM nói. */
async function currentOrderOf({ userId, state }) {
  if (!state.currentOrderId) return null;
  try {
    const o = await getOrder({ userId, orderId: state.currentOrderId });
    if (o.status !== 'PENDING') return null;
    return { id: o.id, code: o.code, status: o.status, expiresAt: o.expiresAt, total: o.total, seats: o.seats, movieTitle: o.showtime.movie.title };
  } catch {
    return null;
  }
}

/** Thời điểm tạo tin kế tiếp: luôn SAU tin mới nhất của phiên để thứ tự không bao giờ đảo. */
async function nextBase(sessionId) {
  const last = await prisma.chatMessage.findFirst({ where: { sessionId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
  return Math.max(Date.now(), (last?.createdAt.getTime() ?? 0) + 1);
}

// ------------------------------------------------------------------ API của service ------------------------------------------------------------------

/**
 * Nhận một tin nhắn của khách, cho Agent xử lý, lưu hội thoại.
 * Tool GHI (giữ ghế, combo, mã, link thanh toán, hủy đơn) KHÔNG chạy ở đây — kết quả có thể kèm `pendingAction` chờ khách xác nhận.
 * @param {{ userId: string, sessionId?: string, text: string, now?: Date }} params
 * @returns {Promise<{ sessionId: string, reply: { text: string, pendingAction: { actionId: string, tool: string, summary: string, expiresAt: string }|null } }>}
 * @throws {AppError} VALIDATION_ERROR | RATE_LIMITED | AI_UNAVAILABLE | NOT_FOUND | FORBIDDEN
 */
export async function chat({ userId, sessionId, text, now = new Date() }) {
  const clean = String(text ?? '').trim();
  if (!clean) throw fieldError('text', 'Vui lòng nhập nội dung tin nhắn.');
  if (clean.length > MAX_TEXT_LENGTH) throw fieldError('text', `Tin nhắn tối đa ${MAX_TEXT_LENGTH} ký tự.`);
  checkRateLimit(userId, now.getTime());
  const llm = getLlm(); // AI_UNAVAILABLE nếu chưa cấu hình

  const session = sessionId ? await loadOwnedSession({ sessionId, userId }) : null;
  const state = session ? readState(session) : {};
  const rows = session
    ? (await prisma.chatMessage.findMany({ where: { sessionId: session.id }, orderBy: { createdAt: 'desc' }, take: HISTORY_LIMIT - 1 })).reverse()
    : [];
  const userMessage = { role: 'user', content: clean };

  let result;
  try {
    result = await runAgentTurn({
      userId, llm, now,
      system: buildSystemPrompt({ now, currentOrder: await currentOrderOf({ userId, state }) }),
      history: [...toLlmMessages(rows), userMessage],
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[ai] LLM lỗi:', err);
    throw new AppError('AI_UNAVAILABLE'); // không lộ chi tiết kỹ thuật
  }

  // Lưu hội thoại + trạng thái trong MỘT transaction: tin của khách, các lượt gọi tool, câu trả lời, việc đang chờ xác nhận.
  const id = session ? session.id : (await prisma.chatSession.create({ data: { userId } })).id;
  const base = session ? await nextBase(id) : Date.now();
  const messages = [userMessage, ...result.newMessages].map((m, i) => toRow(m, id, new Date(base + i)));
  await prisma.$transaction([
    prisma.chatMessage.createMany({ data: messages }),
    prisma.chatSession.update({ where: { id }, data: { state: { ...state, pendingAction: result.pendingAction }, lastActiveAt: new Date(Math.max(now.getTime(), (session?.lastActiveAt.getTime() ?? 0) + 1)) } }),
  ]);
  return { sessionId: id, reply: { text: result.text, pendingAction: publicPending(result.pendingAction) } };
}

/** Câu trả lời cho khách khi thao tác đã xác nhận nhưng thất bại (ghế vừa bị lấy, mã không dùng được...). */
function explainFailure(err) {
  if (!(err instanceof AppError)) {
    console.error('[ai] lỗi khi thực thi thao tác đã xác nhận:', err);
    return 'Có lỗi hệ thống khi thực hiện thao tác này. Bạn thử lại sau một chút nhé.';
  }
  const reason = err.code === 'PROMO_INVALID' ? PROMO_REASONS[err.details?.reason] : null;
  const next = err.code === 'SEAT_UNAVAILABLE' ? ' Bạn muốn mình gợi ý ghế khác không?' : '';
  return `${reason ?? err.message}${next}`;
}

/**
 * ⭐ Khách bấm Xác nhận / Hủy một thao tác đang chờ. Đây là CÁCH DUY NHẤT một tool ghi được thực thi.
 * - Chỉ chủ phiên; `actionId` phải trùng việc đang chờ và còn hạn (5 phút).
 * - Mỗi việc chạy ĐÚNG MỘT LẦN: "nhận phần" bằng một câu cập nhật có điều kiện (so sánh `lastActiveAt`) trước khi thực thi,
 *   nên bấm đúp hay gửi song song chỉ một request thắng — các request còn lại nhận NOT_FOUND.
 * - Thất bại nghiệp vụ (SEAT_UNAVAILABLE, PROMO_INVALID...) được diễn đạt trong `reply`, không trả lỗi HTTP.
 * @param {{ userId: string, sessionId: string, actionId: string, approve: boolean, now?: Date }} params
 * @returns {Promise<{ reply: { text: string, order?: object, paymentUrl?: string } }>}
 * @throws {AppError} VALIDATION_ERROR | NOT_FOUND (không có việc chờ / đã dùng / hết hạn) | FORBIDDEN
 */
export async function confirm({ userId, sessionId, actionId, approve, now = new Date() }) {
  if (typeof approve !== 'boolean') throw fieldError('approve', 'approve phải là true hoặc false.');
  const session = await loadOwnedSession({ sessionId, userId });
  const state = readState(session);
  const pending = state.pendingAction;
  const noPending = () => new AppError('NOT_FOUND', { message: 'Không có thao tác nào đang chờ xác nhận (có thể đã hết hạn hoặc đã được xử lý).' });
  if (!pending || pending.actionId !== actionId) throw noPending();

  // Nhận phần: chỉ MỘT request cập nhật được (điều kiện lastActiveAt còn nguyên giá trị đã đọc).
  const claimed = await prisma.chatSession.updateMany({
    where: { id: session.id, lastActiveAt: session.lastActiveAt },
    data: { state: { ...state, pendingAction: null }, lastActiveAt: new Date(Math.max(now.getTime(), session.lastActiveAt.getTime() + 1)) },
  });
  if (claimed.count !== 1) throw noPending();
  if (new Date(pending.expiresAt) <= now) throw noPending(); // đã gỡ việc chờ ở trên; không thực thi

  let reply;
  let currentOrderId = state.currentOrderId;
  if (!approve) {
    reply = { text: 'Mình đã hủy yêu cầu đó. Bạn cần mình giúp gì tiếp không?' };
  } else {
    try {
      const done = await getTool(pending.tool).execute({ userId, input: pending.input });
      reply = { text: done.text, ...(done.order && { order: done.order }), ...(done.paymentUrl && { paymentUrl: done.paymentUrl }) };
      if (done.orderId) currentOrderId = done.orderId;
    } catch (err) {
      reply = { text: explainFailure(err) };
    }
  }

  const base = await nextBase(session.id);
  await prisma.$transaction([
    prisma.chatMessage.create({ data: { sessionId: session.id, role: 'ASSISTANT', content: reply.text, createdAt: new Date(base) } }),
    prisma.chatSession.update({ where: { id: session.id }, data: { state: { ...state, pendingAction: null, currentOrderId } } }),
  ]);
  return { reply };
}

/**
 * Nạp lại khung chat (sau khi tải lại trang): các tin hiển thị được và việc đang chờ xác nhận (nếu còn hạn).
 * @param {{ userId: string, sessionId: string, now?: Date }} params
 * @returns {Promise<{ sessionId: string, status: string, messages: Array<{ role: 'USER'|'ASSISTANT', text: string, createdAt: Date }>, pendingAction: object|null }>}
 * @throws {AppError} NOT_FOUND | FORBIDDEN
 */
export async function getSession({ userId, sessionId, now = new Date() }) {
  const session = await loadOwnedSession({ sessionId, userId });
  const rows = await prisma.chatMessage.findMany({ where: { sessionId, role: { in: ['USER', 'ASSISTANT'] } }, orderBy: { createdAt: 'asc' } });
  const pending = readState(session).pendingAction;
  return {
    sessionId: session.id,
    status: session.status,
    messages: rows.filter((r) => r.content.trim()).map((r) => ({ role: r.role, text: r.content, createdAt: r.createdAt })),
    pendingAction: pending && new Date(pending.expiresAt) > now ? publicPending(pending) : null,
  };
}

/**
 * Đóng phiên (bắt đầu cuộc trò chuyện mới). Gỡ luôn việc đang chờ xác nhận.
 * @param {{ userId: string, sessionId: string }} params
 * @returns {Promise<{ sessionId: string, status: 'CLOSED' }>}
 * @throws {AppError} NOT_FOUND | FORBIDDEN
 */
export async function closeSession({ userId, sessionId }) {
  const session = await loadOwnedSession({ sessionId, userId });
  await prisma.chatSession.update({ where: { id: session.id }, data: { status: 'CLOSED', state: { ...readState(session), pendingAction: null } } });
  return { sessionId: session.id, status: 'CLOSED' };
}
