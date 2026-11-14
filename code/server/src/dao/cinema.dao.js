import { prisma } from '../config/prisma.js';

/** Rạp ĐANG HOẠT ĐỘNG (rạp đã tắt coi như không có). @returns {Promise<{ id: string, name: string, address: string }|null>} */
export const findActiveCinemaSummary = (cinemaId, db = prisma) =>
  db.cinema.findFirst({ where: { id: cinemaId, isActive: true }, select: { id: true, name: true, address: true } });
