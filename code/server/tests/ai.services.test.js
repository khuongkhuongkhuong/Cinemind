// Các service dành cho trợ lý AI (docs/07 mục 10): tìm phim / rạp theo tên, findShowtimes, suggestSeats, holdSeats(source).
// Cần dữ liệu mẫu: chạy `npm run db:seed` trước. suggestSeats chạy trên PHÒNG RIÊNG có sơ đồ ghế do test kiểm soát.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { prisma } = await import('../src/config/prisma.js');
const catalog = await import('../src/services/catalog.service.js');
const showtimeSvc = await import('../src/services/showtime.service.js');
const booking = await import('../src/services/booking.service.js');
const { getSurcharges } = await import('../src/services/pricing.service.js');
const { default: app } = await import('../src/app.js');
const { signAccessToken } = await import('../src/lib/jwt.js');

const minute = 60_000;
const DAY = 24 * 60 * minute;
const RUN = Date.now();
const failErr = (p) => p.then(() => null, (e) => e);
let room; let showtime; let customer; let other; let server; let base;
let seatsByLabel; const orderIds = [];

/**
 * Sơ đồ phòng test (A phía trước, D phía sau):
 *  A: 1-10 thường · B: 1-10 VIP · C: 1-5 thường + 6-10 VIP (hàng LẪN loại) · D: 4 ghế đôi (D1-2, D3-4).
 */
async function buildRoom() {
  const cinema = await prisma.cinema.findFirst({ where: { isActive: true } });
  room = await prisma.room.create({ data: { cinemaId: cinema.id, name: `TestRoom-${RUN}-ai` } });
  const data = [];
  for (let n = 1; n <= 10; n++) data.push({ roomId: room.id, row: 'A', number: n, type: 'STANDARD' });
  for (let n = 1; n <= 10; n++) data.push({ roomId: room.id, row: 'B', number: n, type: 'VIP' });
  for (let n = 1; n <= 10; n++) data.push({ roomId: room.id, row: 'C', number: n, type: n <= 5 ? 'STANDARD' : 'VIP' });
  for (let n = 1; n <= 4; n++) data.push({ roomId: room.id, row: 'D', number: n, type: 'COUPLE', pairCode: n <= 2 ? 'D1-2' : 'D3-4' });
  await prisma.seat.createMany({ data });
  const seats = await prisma.seat.findMany({ where: { roomId: room.id } });
  seatsByLabel = Object.fromEntries(seats.map((s) => [`${s.row}${s.number}`, s]));
}

/** Chiếm ghế bằng một đơn thật (SeatLock cần orderId). `held` = đang giữ còn hạn; `expired` = giữ đã quá hạn; `sold` = đã bán. */
async function occupy(labels, kind = 'held') {
  const order = await prisma.order.create({
    data: {
      code: `AI${RUN}${orderIds.length}${Math.floor(Math.random() * 1e3)}`.slice(-10), userId: other.id, showtimeId: showtime.id,
      status: kind === 'sold' ? 'PAID' : 'PENDING', expiresAt: new Date(Date.now() + 10 * minute), seatTotal: 0, total: 0,
    },
  });
  orderIds.push(order.id);
  await prisma.seatLock.createMany({
    data: labels.map((l) => ({
      showtimeId: showtime.id, seatId: seatsByLabel[l].id, orderId: order.id,
      status: kind === 'sold' ? 'SOLD' : 'HELD',
      expiresAt: kind === 'sold' ? null : new Date(Date.now() + (kind === 'expired' ? -minute : 10 * minute)),
    })),
  });
}
const release = async () => { await prisma.seatLock.deleteMany({ where: { showtimeId: showtime.id } }); };

before(async () => {
  await buildRoom();
  const movie = await prisma.movie.findFirst({ where: { status: 'NOW_SHOWING' } });
  const start = new Date(Math.ceil((Date.now() + 60 * DAY) / (60 * minute)) * 60 * minute);
  showtime = await showtimeSvc.createShowtime({ movieId: movie.id, roomId: room.id, startTime: start, format: 'F2D', audio: 'SUBTITLE', basePrice: 80_000 });
  customer = await prisma.user.create({ data: { email: `test-aisv-${RUN}-a@example.com`, passwordHash: 'x', fullName: 'Test A' } });
  other = await prisma.user.create({ data: { email: `test-aisv-${RUN}-b@example.com`, passwordHash: 'x', fullName: 'Test B' } });
  server = app.listen(0);
  base = `http://localhost:${server.address().port}/api/v1`;
});
after(async () => {
  server.close();
  await prisma.order.deleteMany({ where: { userId: { in: [customer.id, other.id] } } }); // SeatLock xóa theo (cascade)
  await prisma.showtime.deleteMany({ where: { roomId: room.id } });
  await prisma.seat.deleteMany({ where: { roomId: room.id } });
  await prisma.room.delete({ where: { id: room.id } });
  await prisma.user.deleteMany({ where: { id: { in: [customer.id, other.id] } } });
  await prisma.$disconnect();
});

// ------------------------------------------------------------------ tìm kiếm theo tên ------------------------------------------------------------------

test('searchMovies: tên không dấu / hoa thường đều ra; lọc thể loại theo TÊN; trạng thái; limit; thể loại lạ -> []', async () => {
  const all = await catalog.searchMovies({});
  assert.ok(all.length >= 5 && all.length <= 10);
  assert.ok(all.every((m) => m.id && m.title && Array.isArray(m.genres) && typeof m.genres[0] === 'string' || m.genres.length === 0));
  const first = all[0];
  const unaccented = first.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toUpperCase();
  const found = await catalog.searchMovies({ query: unaccented });
  assert.ok(found.some((m) => m.id === first.id), `không tìm thấy "${unaccented}"`);

  // Chọn thể loại CÓ phim (test khác chạy song song có thể tạo thể loại tạm chưa gắn phim nào).
  const genre = (await prisma.genre.findFirst({ where: { movies: { some: {} } } })).name;
  const byGenre = await catalog.searchMovies({ genre: genre.toUpperCase() });
  assert.ok(byGenre.length > 0);
  // Khớp theo chuỗi con không dấu nên một phim có thể thuộc thể loại có tên chứa từ khóa; chỉ cần có ĐÚNG thể loại đã hỏi.
  assert.ok(byGenre.every((m) => m.genres.some((g) => g.toLowerCase().includes(genre.toLowerCase()))));
  assert.deepEqual(await catalog.searchMovies({ genre: 'thể loại không tồn tại' }), []);

  const showing = await catalog.searchMovies({ status: 'NOW_SHOWING', limit: 3 });
  assert.ok(showing.length <= 3 && showing.every((m) => m.status === 'NOW_SHOWING'));
  assert.equal((await catalog.searchMovies({ limit: 9999 })).length <= 20, true); // trần 20
});

test('getMovieById: có / không tồn tại -> NOT_FOUND', async () => {
  const [m] = await catalog.searchMovies({ limit: 1 });
  assert.equal((await catalog.getMovieById({ movieId: m.id })).title, m.title);
  assert.equal((await failErr(catalog.getMovieById({ movieId: '00000000-0000-4000-8000-000000000000' }))).code, 'NOT_FOUND');
});

test('listCinemasByCityName: "ha noi" (không dấu) ra rạp Hà Nội kèm tên thành phố; thành phố lạ -> []', async () => {
  const list = await catalog.listCinemasByCityName({ cityName: 'ha noi' });
  assert.ok(list.length >= 1 && list.every((c) => c.cityName === 'Hà Nội'));
  assert.deepEqual(await catalog.listCinemasByCityName({ cityName: 'Atlantis' }), []);
  assert.deepEqual(await catalog.listCinemasByCityName({ cityName: '   ' }), []);
});

// ------------------------------------------------------------------ findShowtimes ------------------------------------------------------------------

const vnDate = (offsetDays) => new Date(Date.now() + 7 * 60 * minute + offsetDays * DAY).toISOString().slice(0, 10);

test('findShowtimes: danh sách phẳng đủ trường, sắp theo giờ, chỉ suất còn mở bán; theo tên thành phố không dấu', async () => {
  const date = vnDate(2);
  const list = await showtimeSvc.findShowtimes({ date, cityName: 'ha noi' });
  assert.ok(list.length > 0, 'cần dữ liệu mẫu còn suất chiếu 2 ngày tới (chạy db:seed)');
  for (const s of list) {
    assert.ok(s.showtimeId && s.movieTitle && s.cinemaName && /^\d\d:\d\d$/.test(s.startTimeLocal) && s.dateLocal === date);
    assert.ok(Number.isInteger(s.basePrice) && Number.isInteger(s.availableSeatCount) && s.availableSeatCount >= 0);
  }
  const times = list.map((s) => s.startTime.getTime());
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  // Rạp trả về đều thuộc Hà Nội
  const hanoi = new Set((await catalog.listCinemasByCityName({ cityName: 'Hà Nội' })).map((c) => c.id));
  assert.ok(list.every((s) => hanoi.has(s.cinemaId)));
  assert.deepEqual(await showtimeSvc.findShowtimes({ date, cityName: 'Atlantis' }), []);
});

test('findShowtimes: lọc theo phim, giờ (timeFrom/timeTo, giờ VN), định dạng, số lượng', async () => {
  const date = vnDate(2);
  const all = await showtimeSvc.findShowtimes({ date, limit: 50 });
  const movieId = all[0].movieId;
  const byMovie = await showtimeSvc.findShowtimes({ date, movieId, limit: 50 });
  assert.ok(byMovie.length > 0 && byMovie.every((s) => s.movieId === movieId));

  const evening = await showtimeSvc.findShowtimes({ date, timeFrom: '18:00', limit: 50 });
  assert.ok(evening.every((s) => s.startTimeLocal >= '18:00'));
  const morning = await showtimeSvc.findShowtimes({ date, timeTo: '12:00', limit: 50 });
  assert.ok(morning.every((s) => s.startTimeLocal <= '12:00'));
  assert.equal(evening.length + morning.filter((s) => s.startTimeLocal >= '18:00').length, evening.length); // không trùng nhau

  const fmt = all[0].format;
  assert.ok((await showtimeSvc.findShowtimes({ date, format: fmt, limit: 50 })).every((s) => s.format === fmt));
  assert.equal((await showtimeSvc.findShowtimes({ date, limit: 2 })).length, 2);
});

test('⭐ findShowtimes: availableSeatCount trừ ghế đã bán / đang giữ còn hạn, KHÔNG trừ lượt giữ quá hạn (dọn lười)', async () => {
  const date = new Date(showtime.startTime.getTime() + 7 * 60 * minute).toISOString().slice(0, 10);
  const count = async () => (await showtimeSvc.findShowtimes({ date, cinemaId: room.cinemaId, movieId: showtime.movie.id, limit: 50 })).find((s) => s.showtimeId === showtime.id).availableSeatCount;
  await release();
  assert.equal(await count(), 34); // 10 + 10 + 10 + 4
  await occupy(['A1', 'A2'], 'held');
  await occupy(['A3'], 'sold');
  await occupy(['A4', 'A5'], 'expired');
  assert.equal(await count(), 31); // 34 − 2 (giữ) − 1 (bán); 2 ghế giữ quá hạn vẫn tính là trống
  await release();
});

test('findShowtimes: suất đã hủy và suất đã đóng bán (< 15 phút) không xuất hiện; tham số sai -> VALIDATION_ERROR', async () => {
  const movie = await prisma.movie.findFirst({ where: { status: 'NOW_SHOWING' } });
  const t = (offsetMin) => new Date(Date.now() + offsetMin * minute);
  const mk = (start, status = 'OPEN') => prisma.showtime.create({
    data: { movieId: movie.id, roomId: room.id, startTime: start, endTime: new Date(start.getTime() + 60 * minute), format: 'F3D', audio: 'DUBBED', basePrice: 90_000, status },
  });
  const closing = await mk(t(5)); // còn 5 phút: đã đóng bán
  const cancelled = await mk(t(300), 'CANCELLED');
  const date = new Date(t(5).getTime() + 7 * 60 * minute).toISOString().slice(0, 10);
  const ids = (await showtimeSvc.findShowtimes({ date, cinemaId: room.cinemaId, format: 'F3D', limit: 50 })).map((s) => s.showtimeId);
  assert.ok(!ids.includes(closing.id) && !ids.includes(cancelled.id));

  for (const bad of [{}, { date: '2026-13-45' }, { date: 'mai' }, { date: vnDate(1), timeFrom: '25:00' }, { date: vnDate(1), timeTo: '6pm' }]) {
    assert.equal((await failErr(showtimeSvc.findShowtimes(bad))).code, 'VALIDATION_ERROR', JSON.stringify(bad));
  }
});

// ------------------------------------------------------------------ suggestSeats ------------------------------------------------------------------

const suggest = (extra) => showtimeSvc.suggestSeats({ showtimeId: showtime.id, ...extra });
const nums = (labels) => labels.map((l) => Number(l.slice(1)));

test('suggestSeats: tối đa 3 phương án, mỗi phương án là ghế LIỀN NHAU cùng hàng cùng loại, đủ số lượng, hàng khác nhau', async () => {
  await release();
  const options = await suggest({ quantity: 3 });
  assert.equal(options.length, 3);
  assert.equal(new Set(options.map((o) => o.row)).size, 3); // ưu tiên hàng khác nhau
  for (const o of options) {
    assert.equal(o.seatIds.length, 3);
    const n = nums(o.labels);
    assert.deepEqual(n, [n[0], n[0] + 1, n[0] + 2]); // liền nhau
    assert.ok(o.labels.every((l) => l[0] === o.row));
    assert.notEqual(o.seatType, 'COUPLE'); // không tự chọn ghế đôi
  }
});

test('⭐ suggestSeats: totalPrice KHỚP tổng tiền đơn thật sau holdSeats; đơn tạo qua AI có source = AI_CHAT', async () => {
  await release();
  const [best] = await suggest({ quantity: 2, seatType: 'VIP' });
  assert.equal(best.seatType, 'VIP');
  const surcharges = await getSurcharges();
  assert.equal(best.totalPrice, 2 * (80_000 + surcharges.VIP));
  const order = await booking.holdSeats({ userId: customer.id, showtimeId: showtime.id, seatIds: best.seatIds, source: 'AI_CHAT' });
  assert.equal(order.total, best.totalPrice);
  assert.equal((await prisma.order.findUnique({ where: { id: order.id } })).source, 'AI_CHAT');
  await booking.cancelOrder({ userId: customer.id, orderId: order.id });
});

test('⭐ suggestSeats: gợi ý xong, ghế vẫn có thể bị lấy mất — holdSeats là trọng tài (SEAT_UNAVAILABLE), gợi ý mới không còn ghế đó', async () => {
  await release();
  const [best] = await suggest({ quantity: 2 });
  await occupy(best.labels, 'held'); // người khác nhanh tay hơn
  const err = await failErr(booking.holdSeats({ userId: customer.id, showtimeId: showtime.id, seatIds: best.seatIds, source: 'AI_CHAT' }));
  assert.equal(err.code, 'SEAT_UNAVAILABLE');
  const again = await suggest({ quantity: 2 });
  assert.ok(again.every((o) => o.seatIds.every((id) => !best.seatIds.includes(id))));
  await release();
});

test('suggestSeats: bỏ qua ghế đã bán / đang giữ, coi lượt giữ QUÁ HẠN là trống; không có chỗ liền nhau -> []', async () => {
  await release();
  await occupy(['A4', 'A5', 'A6', 'B3'], 'held');
  await occupy(['C2'], 'sold');
  await occupy(['A8'], 'expired'); // quá hạn: coi như trống
  const taken = new Set(['A4', 'A5', 'A6', 'B3', 'C2']);
  const options = await suggest({ quantity: 4, limit: 10 });
  assert.ok(options.length > 0);
  assert.ok(options.every((o) => o.labels.every((l) => !taken.has(l))));
  // Ghế quá hạn A8 được phép xuất hiện: cụm A7-A10 phải nằm trong các phương án hàng A
  assert.ok(options.some((o) => o.row === 'A' && o.labels.includes('A8')));

  // Làm cho mọi hàng thường đều bị "răng cưa": cách một ghế lại có một ghế bị chiếm => không còn 3 ghế liền nhau
  await release();
  await occupy(['A3', 'A6', 'A9', 'B3', 'B6', 'B9', 'C3', 'C6', 'C9'], 'sold');
  assert.deepEqual(await suggest({ quantity: 3 }), []);
  assert.equal((await suggest({ quantity: 2 })).length > 0, true);
  await release();
});

test('suggestSeats: KHÔNG gợi ý dải ghế vắt qua hai loại (hàng C: thường 1-5 rồi VIP 6-10) — cùng loại thì cùng giá', async () => {
  await release();
  const options = await suggest({ quantity: 6, limit: 10 });
  assert.ok(options.length > 0);
  assert.ok(options.every((o) => o.row !== 'C'), 'hàng C không có 6 ghế liền nhau CÙNG LOẠI');
  // 2 ghế: được phép ở hàng C nhưng phải nằm trọn trong một nửa (không có cặp C5-C6)
  const two = await suggest({ quantity: 2, limit: 10 });
  assert.ok(two.every((o) => !(o.labels.includes('C5') && o.labels.includes('C6'))));
  assert.ok(two.every((o) => new Set(o.labels.map((l) => seatsByLabel[l].type)).size === 1));
});

test('suggestSeats: ghế đôi — theo CẶP liền nhau, cùng pairCode; số ghế lẻ -> lỗi; không tự chọn ghế đôi khi không yêu cầu', async () => {
  await release();
  const options = await suggest({ quantity: 2, seatType: 'COUPLE' });
  assert.equal(options.length, 2); // D1-2 và D3-4
  for (const o of options) {
    assert.equal(o.seatType, 'COUPLE');
    assert.equal(o.seatIds.length, 2);
    const pair = o.labels.map((l) => seatsByLabel[l].pairCode);
    assert.equal(pair[0], pair[1]);
  }
  const surcharges = await getSurcharges();
  assert.equal(options[0].totalPrice, 80_000 * 2 + surcharges.COUPLE); // BR-13: giá gốc × 2 + phụ thu đôi (cả cặp)
  assert.equal((await failErr(suggest({ quantity: 3, seatType: 'COUPLE' }))).code, 'VALIDATION_ERROR');

  await occupy(['D1'], 'held'); // một nửa cặp bị chiếm -> cả cặp D1-2 không dùng được
  const rest = await suggest({ quantity: 2, seatType: 'COUPLE' });
  assert.deepEqual(rest.map((o) => o.labels), [['D3', 'D4']]);
  assert.equal((await suggest({ quantity: 4, seatType: 'COUPLE' })).length, 0); // cần 2 cặp liền nhau, chỉ còn 1
  await release();
  const four = await suggest({ quantity: 4, seatType: 'COUPLE' });
  assert.deepEqual(four.map((o) => o.labels), [['D1', 'D2', 'D3', 'D4']]);
});

test('suggestSeats: preference — BACK ưu tiên hàng sau, AISLE sát đầu/cuối hàng, CENTER ở giữa', async () => {
  await release();
  const back = await suggest({ quantity: 2, preference: 'BACK', seatType: 'STANDARD' });
  assert.equal(back[0].row, 'C'); // hàng thường ở xa màn hình nhất
  const aisle = await suggest({ quantity: 2, preference: 'AISLE', seatType: 'STANDARD' });
  const n = nums(aisle[0].labels);
  assert.ok(n[0] === 1 || n[n.length - 1] === 10, `phương án đầu phải sát lối đi: ${aisle[0].labels}`);
  const center = await suggest({ quantity: 2, preference: 'CENTER', seatType: 'STANDARD' });
  const c = nums(center[0].labels);
  assert.ok(c[0] >= 4 && c[c.length - 1] <= 7, `phương án đầu phải ở giữa: ${center[0].labels}`);
});

test('suggestSeats: `limit` có trần 10 phương án (không tràn ngữ cảnh của LLM) và tối thiểu 1', async () => {
  await release();
  assert.equal((await suggest({ quantity: 1, limit: 100 })).length, 10); // 1 ghế có hàng chục cách chọn, vẫn chỉ trả 10
  assert.equal((await suggest({ quantity: 1, limit: 1 })).length, 1);
  assert.equal((await suggest({ quantity: 1, limit: 0 })).length, 1); // limit lố nhỏ được kéo về 1
});

test('suggestSeats: kiểm tra đầu vào — > 8 ghế SEAT_LIMIT_EXCEEDED; 0 / lẻ / sai preference / sai loại ghế VALIDATION_ERROR; suất lạ NOT_FOUND; suất đóng bán SHOWTIME_CLOSED', async () => {
  assert.equal((await failErr(suggest({ quantity: 9 }))).code, 'SEAT_LIMIT_EXCEEDED');
  for (const bad of [{ quantity: 0 }, { quantity: 1.5 }, { quantity: '2' }, { quantity: 2, preference: 'FRONT' }, { quantity: 2, seatType: 'GOLD' }]) {
    assert.equal((await failErr(suggest(bad))).code, 'VALIDATION_ERROR', JSON.stringify(bad));
  }
  assert.equal((await failErr(showtimeSvc.suggestSeats({ showtimeId: '00000000-0000-4000-8000-000000000000', quantity: 2 }))).code, 'NOT_FOUND');
  const movie = await prisma.movie.findFirst({ where: { status: 'NOW_SHOWING' } });
  const soon = new Date(Date.now() + 5 * minute);
  const closing = await prisma.showtime.create({
    data: { movieId: movie.id, roomId: room.id, startTime: soon, endTime: new Date(soon.getTime() + 60 * minute), format: 'F2D', audio: 'SUBTITLE', basePrice: 80_000 },
  });
  assert.equal((await failErr(showtimeSvc.suggestSeats({ showtimeId: closing.id, quantity: 2 }))).code, 'SHOWTIME_CLOSED');
});

// ------------------------------------------------------------------ source ------------------------------------------------------------------

test('⭐ Order.source: mặc định WEB; chỉ AI_CHAT / WEB hợp lệ; API REST KHÔNG nhận `source` từ body (khách không tự gắn nhãn AI)', async () => {
  await release();
  const seatIds = [seatsByLabel.A1.id];
  const web = await booking.holdSeats({ userId: customer.id, showtimeId: showtime.id, seatIds });
  assert.equal((await prisma.order.findUnique({ where: { id: web.id } })).source, 'WEB');
  await booking.cancelOrder({ userId: customer.id, orderId: web.id });

  assert.equal((await failErr(booking.holdSeats({ userId: customer.id, showtimeId: showtime.id, seatIds, source: 'HACK' }))).code, 'VALIDATION_ERROR');

  const res = await fetch(`${base}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signAccessToken({ id: customer.id, role: 'USER' })}` },
    body: JSON.stringify({ showtimeId: showtime.id, seatIds, source: 'AI_CHAT' }),
  });
  assert.equal(res.status, 201);
  const orderId = (await res.json()).data.id;
  assert.equal((await prisma.order.findUnique({ where: { id: orderId } })).source, 'WEB');
  await booking.cancelOrder({ userId: customer.id, orderId });
});
