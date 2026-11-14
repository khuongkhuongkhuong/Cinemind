import { prisma } from '../config/prisma.js';

/** @returns {Promise<object|null>} Room */
export const getRoomById = (roomId, db = prisma) => db.room.findUnique({ where: { id: roomId } });
