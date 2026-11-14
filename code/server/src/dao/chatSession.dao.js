import { prisma } from '../config/prisma.js';

/** @returns {Promise<object|null>} ChatSession */
export const getSessionById = (sessionId, db = prisma) => db.chatSession.findUnique({ where: { id: sessionId } });

/** Mở phiên trò chuyện mới của một user (trạng thái ACTIVE, state rỗng theo schema). */
export const insertSession = (userId, db = prisma) => db.chatSession.create({ data: { userId } });

/** Ghi lại trạng thái phiên (việc chờ xác nhận, đơn đang giữ…) và thời điểm hoạt động. */
export const updateSessionState = ({ sessionId, state, lastActiveAt }, db = prisma) =>
  db.chatSession.update({ where: { id: sessionId }, data: { state, ...(lastActiveAt && { lastActiveAt }) } });

/**
 * ⭐ "Nhận phần" việc chờ xác nhận bằng MỘT câu cập nhật có điều kiện: chỉ ghi khi `lastActiveAt` còn đúng giá trị đã đọc.
 * 10 request xác nhận song song thì chỉ một request có count = 1 và được thực thi thao tác; các request còn lại count = 0.
 * @param {{ sessionId: string, expectedLastActiveAt: Date, state: object, lastActiveAt: Date }} params
 * @returns {Promise<number>} 1 nếu nhận phần được, 0 nếu đã có request khác nhận trước
 */
export const claimPendingAction = async ({ sessionId, expectedLastActiveAt, state, lastActiveAt }, db = prisma) =>
  (await db.chatSession.updateMany({ where: { id: sessionId, lastActiveAt: expectedLastActiveAt }, data: { state, lastActiveAt } })).count;

/** Đóng phiên (CLOSED) và ghi state mới (đã gỡ việc chờ). */
export const markSessionClosed = ({ sessionId, state }, db = prisma) =>
  db.chatSession.update({ where: { id: sessionId }, data: { status: 'CLOSED', state } });
