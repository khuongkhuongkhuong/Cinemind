// Truy vấn nội bộ của lịch chiếu và ghế (showtime / seat / movie / room / cinema).
// Mỗi hàm (truy vấn nội bộ) là một thao tác truy vấn: test kiểm ĐÚNG điều kiện của từng câu. Cần dữ liệu mẫu: chạy `npm run db:seed` trước.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { prisma } = await import('../src/config/prisma.js');
const showtimeSvc = await import('../src/services/showtime.service.js');
const seatSvc = await import('../src/services/seat.service.js');
const movieSvc = await import('../src/services/movie.service.js');
const roomSvc = await import('../src/services/room.service.js');
const catalogSvc = await import('../src/services/catalog.service.js');

const minute = 60_000;
const DAY = 24 * 60 * minute;
const RUN = Date.now();
const NOEXIST = '00000000-0000-4000-8000-000000000000';
let cinema; let room; let movie; let user; let base;
const created = { showtimes: [], orders: [] };

/** Sơ đồ phòng test: A1-A4 thường (A4 HỎNG), B1-B2 ghế đôi. */
before(async () => {
  cinema = await prisma.cinema.findFirst({ where: { name: { startsWith: 'Cinemind' }, isActive: true }, orderBy: { name: 'asc' } });
  movie = await prisma.movie.findFirst({ where: { status: 'NOW_SHOWING', description: { not: 'Mô tả thử' } } });
  room = await prisma.room.create({ data: { cinemaId: cinema.id, name: `TestRoom-${RUN}-daost` } });
  await prisma.seat.createMany({
    data: [
      { roomId: room.id, row: 'A', number: 1, type: 'STANDARD' }, { roomId: room.id, row: 'A', number: 2, type: 'STANDARD' },
      { roomId: room.id, row: 'A', number: 3, type: 'STANDARD' }, { roomId: room.id, row: 'A', number: 4, type: 'STANDARD', isActive: false },
      { roomId: room.id, row: 'B', number: 1, type: 'COUPLE', pairCode: 'B1-2' }, { roomId: room.id, row: 'B', number: 2, type: 'COUPLE', pairCode: 'B1-2' },
    ],
  });
  user = await prisma.user.create({ data: { email: `test-daost-${RUN}@example.com`, passwordHash: 'x', fullName: 'Test' } });
  base = new Date(Math.ceil((Date.now() + 90 * DAY) / (60 * minute)) * 60 * minute);
});
after(async () => {
  await prisma.order.deleteMany({ where: { userId: user.id } }); // Ticket xóa theo (cascade)
  await prisma.showtime.deleteMany({ where: { roomId: room.id } });
  await prisma.seat.deleteMany({ where: { roomId: room.id } });
  await prisma.room.delete({ where: { id: room.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.$disconnect();
});

const at = (offsetMin) => new Date(base.getTime() + offsetMin * minute);
const mk = async (offsetMin, extra = {}) => {
  const s = await showtimeSvc.insertShowtime({
    movieId: movie.id, roomId: room.id, startTime: at(offsetMin), endTime: at(offsetMin + 120), format: 'F2D', audio: 'SUBTITLE', basePrice: 80_000, ...extra,
  });
  created.showtimes.push(s.id);
  return s;
};

test('insertShowtime / updateShowtimeById trả đúng dạng ADMIN_SELECT (kèm phim, phòng, rạp); đọc lại bằng các hàm get*', async () => {
  const s = await mk(0);
  assert.deepEqual(Object.keys(s).sort(), ['audio', 'basePrice', 'endTime', 'format', 'id', 'movie', 'room', 'startTime', 'status']);
  assert.equal(s.room.cinema.id, cinema.id);
  assert.equal(s.status, 'OPEN');

  const upd = await showtimeSvc.updateShowtimeById(s.id, { basePrice: 99_000, audio: 'DUBBED' });
  assert.deepEqual([upd.basePrice, upd.audio], [99_000, 'DUBBED']);
  assert.deepEqual(await showtimeSvc.getShowtimeRoomAndStatus(s.id), { roomId: room.id, status: 'OPEN' });
  assert.equal((await showtimeSvc.getShowtimeWithMovie(s.id)).movie.id, movie.id);
  assert.equal((await showtimeSvc.getShowtimeDetail(s.id)).room.cinema.name, cinema.name);
  assert.equal((await showtimeSvc.getAdminShowtime(s.id)).id, s.id);
  for (const fn of ['getShowtimeDetail', 'getShowtimeWithMovie', 'getShowtimeRoomAndStatus', 'getAdminShowtime']) {
    assert.equal(await showtimeSvc[fn](NOEXIST), null, fn);
  }
});

test('⭐ findOverlapInRoom: chồng lấn thật -> tìm thấy; nối đuôi (kết thúc = bắt đầu) KHÔNG trùng; suất đã hủy và excludeId bị bỏ qua; phòng khác không ảnh hưởng', async () => {
  const s = await mk(1000); // [1000, 1120)
  const probe = (startMin, endMin, extra = {}) => showtimeSvc.findOverlapInRoom({ roomId: room.id, startTime: at(startMin), endTime: at(endMin), ...extra });
  assert.equal((await probe(1060, 1180)).id, s.id); // chồng một phần
  assert.equal((await probe(1010, 1020)).id, s.id); // nằm lọt bên trong
  assert.equal((await probe(900, 1200)).id, s.id); // bao trùm
  assert.equal(await probe(1120, 1240), null); // bắt đầu đúng lúc suất kia kết thúc
  assert.equal(await probe(880, 1000), null); // kết thúc đúng lúc suất kia bắt đầu
  assert.equal(await probe(1060, 1180, { excludeId: s.id }), null); // sửa chính nó
  assert.equal(await showtimeSvc.findOverlapInRoom({ roomId: NOEXIST, startTime: at(1060), endTime: at(1180) }), null);
  await showtimeSvc.updateShowtimeById(s.id, { status: 'CANCELLED' });
  assert.equal(await probe(1060, 1180), null); // suất đã hủy không chiếm phòng
});

test('searchOpenShowtimes / listOpenShowtimesOfMovie / listOpenShowtimesOfCinema: chỉ suất OPEN trong [from, to), lọc đúng phim / định dạng / rạp / thành phố, sắp theo giờ', async () => {
  const a = await mk(2000);
  const b = await mk(2200, { format: 'IMAX' });
  const cancelled = await mk(2400); await showtimeSvc.updateShowtimeById(cancelled.id, { status: 'CANCELLED' });
  const outside = await mk(5000);
  const from = at(1990); const to = at(2500);
  const cityId = (await prisma.cinema.findUnique({ where: { id: cinema.id } })).cityId;

  const all = await showtimeSvc.searchOpenShowtimes({ from, to, cinemaId: cinema.id, movieId: movie.id });
  assert.deepEqual(all.map((s) => s.id), [a.id, b.id]); // không có suất hủy / ngoài khoảng; đúng thứ tự giờ
  assert.ok(all[0].movie.title && all[0].room.cinema.name && Number.isInteger(all[0].basePrice) && all[0].roomId === room.id);
  assert.deepEqual((await showtimeSvc.searchOpenShowtimes({ from, to, cinemaId: cinema.id, format: 'IMAX' })).map((s) => s.id), [b.id]);
  assert.deepEqual((await showtimeSvc.searchOpenShowtimes({ from, to, cinemaId: cinema.id, cityIds: [NOEXIST] })), []);
  assert.equal((await showtimeSvc.searchOpenShowtimes({ from, to, cinemaId: cinema.id, cityIds: [cityId] })).length, 2);

  const ofMovie = await showtimeSvc.listOpenShowtimesOfMovie({ movieId: movie.id, from, to, cityId });
  assert.ok(ofMovie.some((s) => s.id === a.id) && ofMovie.every((s) => s.status === 'OPEN' && s.room.cinema.address));
  assert.deepEqual(await showtimeSvc.listOpenShowtimesOfMovie({ movieId: movie.id, from, to, cityId: NOEXIST }), []);

  const ofCinema = await showtimeSvc.listOpenShowtimesOfCinema({ cinemaId: cinema.id, from, to });
  assert.deepEqual(ofCinema.filter((s) => [a.id, b.id, cancelled.id, outside.id].includes(s.id)).map((s) => s.id), [a.id, b.id]);
  assert.ok(ofCinema[0].movie.slug);
});

test('countAdminShowtimes + findAdminShowtimes: cùng một bộ lọc nên khớp nhau; phân trang skip/take; lọc phòng / khoảng thời gian; bao gồm cả suất đã hủy', async () => {
  const filter = { roomId: room.id, from: at(2000), to: at(2500) };
  const total = await showtimeSvc.countAdminShowtimes(filter);
  assert.equal(total, 3); // gồm suất đã hủy (trang quản trị thấy mọi suất)
  const page1 = await showtimeSvc.findAdminShowtimes(filter, { skip: 0, take: 2 });
  const page2 = await showtimeSvc.findAdminShowtimes(filter, { skip: 2, take: 2 });
  assert.equal(page1.length, 2);
  assert.equal(page2.length, 1);
  const times = [...page1, ...page2].map((s) => s.startTime.getTime());
  assert.deepEqual(times, [...times].sort((x, y) => x - y));
  assert.equal(await showtimeSvc.countAdminShowtimes({ roomId: room.id }), 6); // không giới hạn thời gian: 6 suất trong phòng (ở phút 0, 1000, 2000, 2200, 2400, 5000)
  assert.equal(await showtimeSvc.countAdminShowtimes({ roomId: NOEXIST }), 0);
  assert.equal(await showtimeSvc.countAdminShowtimes({ cinemaId: cinema.id, roomId: room.id, from: at(4900), to: at(5100) }), 1);
});

test('seat (truy vấn nội bộ): ghế theo hàng rồi số; đếm ghế dùng được bỏ ghế hỏng (trạng thái chiếm ghế do ticket.service lo — xem db.ticket.test.js)', async () => {
  const seats = await seatSvc.getSeatsOfRoom(room.id);
  assert.deepEqual(seats.map((s) => `${s.row}${s.number}`), ['A1', 'A2', 'A3', 'A4', 'B1', 'B2']);
  const counts = await seatSvc.countActiveSeatsByRoom([room.id, NOEXIST]);
  assert.deepEqual([...counts], [[room.id, 5]]); // Map roomId -> số ghế; A4 hỏng không tính
});

test('⭐ lọc rạp / phòng / khoảng thời gian: rạp hoặc phòng đã TẮT không hiện; suất đúng bằng `to` bị loại (khoảng nửa mở); suất rạp khác không lẫn vào', async () => {
  const other = await prisma.cinema.findFirst({ where: { name: { startsWith: 'Cinemind' }, isActive: true, id: { not: cinema.id } } });
  const offCinema = await prisma.cinema.create({ data: { cityId: cinema.cityId, name: `TestCinema-${RUN}-off`, address: 'x', isActive: false } });
  const room2 = await prisma.room.create({ data: { cinemaId: other.id, name: `TestRoom-${RUN}-daost2` } });
  const offRoom = await prisma.room.create({ data: { cinemaId: cinema.id, name: `TestRoom-${RUN}-daoff`, isActive: false } });
  const roomInOff = await prisma.room.create({ data: { cinemaId: offCinema.id, name: `TestRoom-${RUN}-daoff2` } });
  try {
    const put = (roomId, offsetMin) => showtimeSvc.insertShowtime({ movieId: movie.id, roomId, startTime: at(offsetMin), endTime: at(offsetMin + 60), format: 'F2D', audio: 'SUBTITLE', basePrice: 70_000 });
    const sOther = await put(room2.id, 11_000);
    const sOffRoom = await put(offRoom.id, 11_000);
    const sOffCinema = await put(roomInOff.id, 11_000);
    const sEdge = await put(room.id, 11_500); // đúng bằng `to`
    const from = at(10_900); const to = at(11_500);

    assert.deepEqual((await showtimeSvc.searchOpenShowtimes({ from, to, cinemaId: offCinema.id })), []); // rạp tắt
    assert.deepEqual((await showtimeSvc.searchOpenShowtimes({ from, to, cinemaId: cinema.id })), []); // phòng tắt + suất cạnh biên không lọt vào
    const found = await showtimeSvc.searchOpenShowtimes({ from, to, cinemaId: other.id });
    assert.deepEqual(found.map((s) => s.id), [sOther.id]);
    assert.equal((await showtimeSvc.searchOpenShowtimes({ from, to: at(11_501), cinemaId: cinema.id })).some((s) => s.id === sEdge.id), true);

    const ofCinema = await showtimeSvc.listOpenShowtimesOfCinema({ cinemaId: cinema.id, from, to: at(11_501) });
    assert.deepEqual(ofCinema.map((s) => s.id).sort(), [sEdge.id, sOffRoom.id].sort()); // đúng rạp (phòng tắt vẫn thuộc rạp này); KHÔNG có suất rạp khác
    assert.ok(!ofCinema.some((s) => s.id === sOther.id || s.id === sOffCinema.id));
    await prisma.showtime.deleteMany({ where: { roomId: { in: [room2.id, offRoom.id, roomInOff.id] } } });
    await prisma.showtime.deleteMany({ where: { id: sEdge.id } });
  } finally {
    await prisma.showtime.deleteMany({ where: { roomId: { in: [room2.id, offRoom.id, roomInOff.id] } } });
    await prisma.room.deleteMany({ where: { id: { in: [room2.id, offRoom.id, roomInOff.id] } } });
    await prisma.cinema.delete({ where: { id: offCinema.id } });
  }
});

test('⭐ service sửa suất: chuyển sang PHÒNG KHÁC mà trùng giờ với suất ở phòng đó -> SHOWTIME_OVERLAP (kiểm trùng theo phòng MỚI)', async () => {
  const svc = await import('../src/services/showtime.service.js');
  const other = await prisma.cinema.findFirst({ where: { name: { startsWith: 'Cinemind' }, isActive: true, id: { not: cinema.id } } });
  const room2 = await prisma.room.create({ data: { cinemaId: other.id, name: `TestRoom-${RUN}-daost3` } });
  try {
    const start = at(13_000);
    const inMain = await svc.createShowtime({ movieId: movie.id, roomId: room.id, startTime: start, format: 'F2D', audio: 'SUBTITLE', basePrice: 80_000 });
    const inOther = await svc.createShowtime({ movieId: movie.id, roomId: room2.id, startTime: at(13_030), format: 'F2D', audio: 'SUBTITLE', basePrice: 80_000 });
    const err = await svc.updateShowtime({ showtimeId: inOther.id, roomId: room.id }).then(() => null, (e) => e);
    assert.equal(err.code, 'SHOWTIME_OVERLAP');
    assert.equal(err.details.conflictShowtimeId, inMain.id);
    const moved = await svc.updateShowtime({ showtimeId: inOther.id, roomId: room.id, startTime: at(14_000) }); // giờ khác thì chuyển được
    assert.equal(moved.room.id, room.id);
  } finally {
    await prisma.showtime.deleteMany({ where: { roomId: { in: [room.id, room2.id] }, startTime: { gte: at(12_900), lte: at(14_100) } } });
    await prisma.room.delete({ where: { id: room2.id } });
  }
});

test('movie / room / cinema (truy vấn nội bộ): đọc đúng, trả null khi không có; rạp đã TẮT coi như không có', async () => {
  assert.equal((await movieSvc.getMovieById(movie.id)).title, movie.title);
  assert.equal(await movieSvc.movieExists(movie.id), true);
  assert.equal(await movieSvc.getMovieById(NOEXIST), null);
  assert.equal(await movieSvc.movieExists(NOEXIST), false);
  assert.equal((await roomSvc.getRoomById(room.id)).name, room.name);
  assert.equal(await roomSvc.getRoomById(NOEXIST), null);

  assert.deepEqual(Object.keys(await catalogSvc.getActiveCinemaSummary(cinema.id)).sort(), ['address', 'id', 'name']);
  const temp = await prisma.cinema.create({ data: { cityId: cinema.cityId, name: `TestCinema-${RUN}-dao`, address: 'x', isActive: false } });
  try {
    assert.equal(await catalogSvc.getActiveCinemaSummary(temp.id), null);
    await prisma.cinema.update({ where: { id: temp.id }, data: { isActive: true } });
    assert.equal((await catalogSvc.getActiveCinemaSummary(temp.id)).name, temp.name);
  } finally {
    await prisma.cinema.delete({ where: { id: temp.id } });
  }
});
