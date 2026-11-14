import { prisma } from '../config/prisma.js';

/** `take` tin MỚI NHẤT của phiên, theo thứ tự mới -> cũ (service đảo lại thành cũ -> mới). */
export const getRecentMessages = ({ sessionId, take }, db = prisma) =>
  db.chatMessage.findMany({ where: { sessionId }, orderBy: { createdAt: 'desc' }, take });

/** Thời điểm của tin mới nhất (để tin kế tiếp luôn SAU nó). @returns {Promise<{ createdAt: Date }|null>} */
export const getLastMessage = (sessionId, db = prisma) =>
  db.chatMessage.findFirst({ where: { sessionId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });

/** Ghi nhiều tin trong MỘT câu lệnh (tin của khách, các lượt gọi tool, câu trả lời). */
export const insertMessages = (rows, db = prisma) => db.chatMessage.createMany({ data: rows });

/** Ghi một tin. @param {{ sessionId: string, role: string, content: string, createdAt: Date }} data */
export const insertMessage = (data, db = prisma) => db.chatMessage.create({ data });

/** Chỉ các tin KHÁCH nhìn thấy (USER và ASSISTANT; lượt gọi tool ẩn), cũ -> mới. */
export const listVisibleMessages = (sessionId, db = prisma) =>
  db.chatMessage.findMany({ where: { sessionId, role: { in: ['USER', 'ASSISTANT'] } }, orderBy: { createdAt: 'asc' } });
