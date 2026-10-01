// Thí nghiệm Ngày 0: chứng minh khóa chính (showtimeId, seatId) chặn trùng ghế khi chạy đồng thời.
// Chạy: node --env-file=.env scripts/spike-seatlock.js
import { prisma } from '../src/config/prisma.js';

await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS spike_lock');
await prisma.$executeRawUnsafe(
  `CREATE TABLE spike_lock (showtime_id int, seat_id text, owner text, PRIMARY KEY (showtime_id, seat_id))`,
);

// Giữ "tất cả hoặc không": chèn từng ghế trong 1 transaction; ghế nào trùng thì lỗi -> rollback hết.
async function hold(owner, seats) {
  try {
    await prisma.$transaction(async (tx) => {
      for (const s of seats) {
        await tx.$executeRaw`INSERT INTO spike_lock VALUES (1, ${s}, ${owner})`;
      }
    });
    return true;
  } catch (e) {
    if (String(e.message).includes('23505') || e.code === 'P2010') return false; // vi phạm UNIQUE
    throw e;
  }
}

// Thử 1: 50 người cùng giành G7, G8 cùng lúc.
const results = await Promise.all(
  Array.from({ length: 50 }, (_, i) => hold(`user${i}`, ['G7', 'G8'])),
);
console.log('Thử 1 - số người giữ được G7+G8:', results.filter(Boolean).length, '(phải là 1)');

// Thử 2: tất cả hoặc không. X giữ A3 trước; Y xin A3+A4 -> thất bại, A4 phải vẫn trống.
await hold('X', ['A3']);
const y = await hold('Y', ['A3', 'A4']);
const a4 = await prisma.$queryRaw`SELECT owner FROM spike_lock WHERE seat_id = 'A4'`;
console.log('Thử 2 - Y thành công?', y, '(phải false); A4 có người giữ?', a4.length > 0, '(phải false)');

await prisma.$executeRawUnsafe('DROP TABLE spike_lock');
await prisma.$disconnect();
