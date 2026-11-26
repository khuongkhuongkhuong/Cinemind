// Cách xếp lịch chiếu của dữ liệu mẫu. Hàm thuần (không đụng database) nên test được.

export const ROOMS_PER_CINEMA = 12;
export const ROOM_FORMATS = ['F2D', 'F3D', 'IMAX', 'F2D', 'F2D', 'F3D', 'F2D', 'F2D', 'F2D', 'F3D', 'F2D', 'F2D']; // định dạng của Phòng 1..12
export const CLEANING_MIN = 15; // khớp cách server tính endTime = thời lượng + 15 phút dọn phòng

const FIRST_START_MIN = 8 * 60; // suất đầu 08:00 giờ VN
const LAST_START_MIN = 23 * 60 + 30; // không mở suất mới sau 23:30
const STAGGER_MIN = 10; // các phòng bắt đầu lệch nhau để khách có nhiều khung giờ
const roundUp5 = (min) => Math.ceil(min / 5) * 5;

// Chia suất theo độ "hot" giống rạp thật: [số phim trong nhóm, trọng số]. Phim đứng đầu danh sách (xếp theo độ phổ biến) được nhiều suất nhất.
const TIERS = [[3, 8], [4, 3]]; // 3 phim đầu ×8, 4 phim kế ×3, còn lại ×1
export function weightOf(rank) {
  let end = 0;
  for (const [size, weight] of TIERS) {
    end += size;
    if (rank < end) return weight;
  }
  return 1;
}

/**
 * Thứ tự phát suất trong một vòng: mỗi phim xuất hiện đúng bằng trọng số, và được RẢI ĐỀU (thuật toán weighted round-robin "mượt"),
 * để một phim hot không chiếm một loạt phòng liền nhau.
 */
export function weightedCycle(movies) {
  const entries = movies.map((movie, rank) => ({ movie, weight: weightOf(rank), credit: 0 }));
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  return Array.from({ length: total }, () => {
    for (const e of entries) e.credit += e.weight;
    const next = entries.reduce((best, e) => (e.credit > best.credit ? e : best));
    next.credit -= total;
    return next.movie;
  });
}

/**
 * Lịch MỘT ngày: mỗi phòng chiếu nối tiếp (suất sau bắt đầu khi suất trước đã dọn xong, làm tròn 5 phút).
 * Phim được chia xoay vòng RIÊNG cho từng thành phố theo trọng số, nên thành phố nào cũng có đủ phim và phim đầu danh sách nhiều suất nhất.
 * `movies` phải xếp theo độ phổ biến giảm dần.
 *
 * @param {{ movies: Array<{ id: string, durationMin: number }>, rooms: Array<{ id: string, city: string, roomIndex: number }>, dayIndex: number }} params
 * @returns {Array<{ room: object, movie: object, startMin: number, endMin: number, order: number }>} phút tính từ 00:00 giờ VN; `order` là thứ tự suất trong phòng
 */
export function buildDaySchedule({ movies, rooms, dayIndex }) {
  const cycle = weightedCycle(movies);
  const turn = new Map(); // thành phố -> đã chia bao nhiêu suất
  const plan = [];
  for (const room of rooms) {
    let startMin = FIRST_START_MIN + room.roomIndex * STAGGER_MIN;
    for (let order = 0; startMin <= LAST_START_MIN; order++) {
      const count = turn.get(room.city) ?? 0;
      turn.set(room.city, count + 1);
      const movie = cycle[(count + dayIndex * 5) % cycle.length]; // đổi điểm bắt đầu mỗi ngày để giờ chiếu không lặp lại y hệt
      const endMin = startMin + movie.durationMin + CLEANING_MIN;
      plan.push({ room, movie, startMin, endMin, order });
      startMin = roundUp5(endMin);
    }
  }
  return plan;
}
