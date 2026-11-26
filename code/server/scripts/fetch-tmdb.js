// Lấy phim thật từ TMDB và ghi vào prisma/seed-data/movies.json. Chạy: npm run db:fetch-movies   (cần TMDB_API_KEY trong .env)
// Chỉ ghi file, KHÔNG đụng database; xem lại file rồi mới `npm run db:seed`.
import { writeFileSync } from 'node:fs';
import { toVnClock } from '../src/lib/time.js';
import { collectMovies, createTmdbGet } from './lib/tmdb.js';

const MIN_NOW_SHOWING = 10; // đủ để phân trang và xếp lịch chiếu đa dạng

const key = process.env.TMDB_API_KEY?.trim();
if (!key) {
  console.error('Thiếu TMDB_API_KEY trong code/server/.env (đăng ký miễn phí tại themoviedb.org → Settings → API).');
  process.exit(1);
}

const today = toVnClock(new Date()).toISOString().slice(0, 10);
const { genres, movies, warnings, skipped } = await collectMovies({ get: createTmdbGet(key), today });
const nowShowing = movies.filter((m) => m.status === 'NOW_SHOWING').length;
if (nowShowing < MIN_NOW_SHOWING) {
  console.error(`Chỉ lấy được ${nowShowing} phim đang chiếu (cần ít nhất ${MIN_NOW_SHOWING}). Giữ nguyên file cũ.`);
  process.exit(1);
}

const output = { source: 'TMDB', fetchedAt: today, genres, movies };
writeFileSync(new URL('../prisma/seed-data/movies.json', import.meta.url), `${JSON.stringify(output, null, 2)}\n`);

console.log(`Đã ghi ${movies.length} phim (${nowShowing} đang chiếu, ${movies.length - nowShowing} sắp chiếu), ${genres.length} thể loại.`);
if (warnings.length) console.log(`\nCần kiểm tra tay (${warnings.length}):\n- ${warnings.join('\n- ')}`);
if (skipped.length) console.log(`\nBỏ qua ${skipped.length} phim thiếu dữ liệu:\n- ${skipped.join('\n- ')}`);
console.log('\nBước tiếp theo: xem lại prisma/seed-data/movies.json rồi chạy `npm run db:seed`.');
