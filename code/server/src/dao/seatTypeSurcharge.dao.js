import { prisma } from '../config/prisma.js';

/** Toàn bộ phụ thu theo loại ghế (BR-13). @returns {Promise<Array<{ seatType: string, surcharge: number }>>} */
export const getAllSurcharges = (db = prisma) => db.seatTypeSurcharge.findMany();
