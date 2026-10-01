import { PrismaClient } from '@prisma/client';

// Một PrismaClient dùng chung cho cả app (mỗi client giữ một pool kết nối tới DB).
export const prisma = new PrismaClient();
