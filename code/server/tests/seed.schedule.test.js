// Xếp lịch chiếu của dữ liệu mẫu. Không cần database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDaySchedule, CLEANING_MIN, ROOM_FORMATS, ROOMS_PER_CINEMA, weightedCycle, weightOf } from '../prisma/schedule.js';

const movies = Array.from({ length: 15 }, (_, i) => ({ id: `m${i}`, durationMin: 90 + ((i * 17) % 110) })); // 90–199 phút
const roomsOf = (city, cinemas) => Array.from({ length: cinemas * ROOMS_PER_CINEMA }, (_, i) => ({ id: `${city}-${i}`, city, roomIndex: i % ROOMS_PER_CINEMA }));
const rooms = [...roomsOf('HN', 4), ...roomsOf('HCM', 3), ...roomsOf('DN', 2)];

test('mỗi định dạng phòng được khai báo đủ', () => assert.equal(ROOM_FORMATS.length, ROOMS_PER_CINEMA));

test('trong một phòng: suất không chồng nhau (đã tính dọn phòng), giờ bắt đầu từ 08:00 đến 23:30, tròn 5 phút', () => {
  const plan = buildDaySchedule({ movies, rooms, dayIndex: 3 });
  for (const room of rooms) {
    const list = plan.filter((p) => p.room.id === room.id);
    assert.ok(list.length >= 4, `phòng ${room.id} chỉ có ${list.length} suất`);
    list.forEach((p, i) => {
      assert.equal(p.endMin - p.startMin, p.movie.durationMin + CLEANING_MIN);
      assert.ok(p.startMin >= 8 * 60 && p.startMin <= 23 * 60 + 30 && p.startMin % 5 === 0);
      assert.equal(p.order, i);
      if (i) assert.ok(p.startMin >= list[i - 1].endMin && p.startMin - list[i - 1].endMin < 5);
    });
  }
});

test('trọng số: 3 phim đầu ×8, 4 phim kế ×3, còn lại ×1; một vòng chứa đúng số lần và phim hot được rải đều', () => {
  assert.deepEqual(movies.map((_, i) => weightOf(i)), [8, 8, 8, 3, 3, 3, 3, 1, 1, 1, 1, 1, 1, 1, 1]);
  const cycle = weightedCycle(movies);
  assert.equal(cycle.length, 44);
  movies.forEach((m, i) => assert.equal(cycle.filter((x) => x === m).length, weightOf(i)));
  for (let i = 0; i < cycle.length; i++) assert.notEqual(cycle[i], cycle[(i + 1) % cycle.length]); // không phát hai suất liền cho cùng một phim
});

test('⭐ mỗi thành phố, mỗi ngày: phim nào cũng có suất, phim hot nhiều hơn hẳn phim thường', () => {
  for (let dayIndex = 0; dayIndex < 14; dayIndex++) {
    const plan = buildDaySchedule({ movies, rooms, dayIndex });
    for (const city of ['HN', 'HCM', 'DN']) {
      const counts = movies.map((m) => plan.filter((p) => p.room.city === city && p.movie.id === m.id).length);
      const [hot, mid, low] = [counts.slice(0, 3), counts.slice(3, 7), counts.slice(7)];
      const info = `${city} ngày ${dayIndex}: ${counts}`;
      assert.ok(Math.min(...low) >= 2, info);
      assert.ok(Math.min(...hot) > Math.max(...mid), info);
      assert.ok(Math.min(...mid) > Math.max(...low), info);
    }
  }
});
