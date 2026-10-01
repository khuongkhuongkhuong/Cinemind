// Quản lý phim (admin): tạo / sửa / đổi trạng thái / xóa, cùng các ràng buộc với lịch chiếu.
// Cần dữ liệu mẫu: chạy `npm run db:seed` trước.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { prisma } = await import('../src/config/prisma.js');
const svc = await import('../src/services/adminMovie.service.js');
const { getMovieBySlug } = await import('../src/services/catalog.service.js');
const { default: app } = await import('../src/app.js');
const { signAccessToken } = await import('../src/lib/jwt.js');
const { createRoleUsers } = await import('./helpers/role-users.js');

const RUN = Date.now();
const DAY = 86_400_000;
const TITLE = `Phim Thử Nghiệm ${RUN}`; // "Phim Thu Nghiem <RUN>" khi bỏ dấu
let room; let genres; let user; let roles;
const movieIds = new Set();

const failCode = (p) => p.then(() => null, (e) => e.code);
const base = (extra = {}) => ({
  title: TITLE, description: 'Mô tả thử', durationMin: 100, ageRating: 'T13', releaseDate: '2026-12-01', ...extra,
});
const create = async (data) => { const m = await svc.createMovie(data); movieIds.add(m.id); return m; };
const addShowtime = (movieId, { startOffsetDays, status = 'OPEN' }) => prisma.showtime.create({
  data: {
    movieId, roomId: room.id, status, format: 'F2D', audio: 'SUBTITLE', basePrice: 75_000,
    startTime: new Date(Date.now() + startOffsetDays * DAY), endTime: new Date(Date.now() + startOffsetDays * DAY + 2 * 3600_000),
  },
});

before(async () => {
  const cinema = await prisma.cinema.findFirst();
  room = await prisma.room.create({ data: { cinemaId: cinema.id, name: `TestRoom-${RUN}-M` } });
  genres = await prisma.genre.findMany({ take: 3, orderBy: { name: 'asc' } });
  user = await prisma.user.create({ data: { email: `test-amov-${RUN}@example.com`, passwordHash: 'x', fullName: 'Test' } });
  roles = await createRoleUsers(prisma, `mov${RUN}`);
});

after(async () => {
  const ids = [...movieIds];
  await prisma.showtime.deleteMany({ where: { OR: [{ roomId: room.id }, { movieId: { in: ids } }] } });
  await prisma.room.delete({ where: { id: room.id } });
  await prisma.movie.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.delete({ where: { id: user.id } });
  await roles.cleanup();
  await prisma.$disconnect();
});

test('tạo phim: sinh slug không dấu, searchKey, gắn thể loại, mặc định COMING_SOON, trả MovieDetail', async () => {
  const m = await create(base({ genreIds: [genres[0].id, genres[1].id], director: 'Đạo diễn A', posterUrl: 'https://example.com/p.jpg' }));
  assert.equal(m.slug, `phim-thu-nghiem-${RUN}`);
  assert.equal(m.status, 'COMING_SOON');
  assert.equal(m.releaseDate, '2026-12-01');
  assert.deepEqual(m.genres.map((g) => g.id).sort(), [genres[0].id, genres[1].id].sort());
  assert.equal(m.director, 'Đạo diễn A');
  const row = await prisma.movie.findUnique({ where: { id: m.id } });
  assert.equal(row.searchKey, `phim thu nghiem ${RUN}`);
});

test('⭐ trùng tên: slug được thêm hậu tố -2, -3...; 5 phim cùng tên tạo ĐỒNG THỜI vẫn ra 5 slug khác nhau (UNIQUE làm trọng tài)', async () => {
  const title = `Trùng Tên ${RUN}`;
  const a = await create(base({ title }));
  const b = await create(base({ title }));
  assert.deepEqual([a.slug, b.slug], [`trung-ten-${RUN}`, `trung-ten-${RUN}-2`]);

  const title2 = `Đua Nhau ${RUN}`;
  const many = await Promise.all(Array.from({ length: 5 }, () => svc.createMovie(base({ title: title2 }))));
  many.forEach((m) => movieIds.add(m.id));
  assert.equal(new Set(many.map((m) => m.slug)).size, 5);
});

test('tạo phim: thể loại không tồn tại -> VALIDATION_ERROR', async () => {
  const err = await svc.createMovie(base({ genreIds: ['00000000-0000-4000-8000-000000000000'] })).catch((e) => e);
  assert.equal(err.code, 'VALIDATION_ERROR');
  assert.ok(err.details.fields.genreIds);
});

test('⭐ sửa phim: đổi tên cập nhật searchKey nhưng GIỮ slug; thay cả danh sách thể loại; trường không gửi giữ nguyên', async () => {
  const m = await create(base({ title: `Tên Cũ ${RUN}`, genreIds: [genres[0].id] }));
  const u = await svc.updateMovie({ movieId: m.id, title: `Tên Mới ${RUN}`, genreIds: [genres[1].id, genres[2].id] });
  assert.equal(u.title, `Tên Mới ${RUN}`);
  assert.equal(u.slug, m.slug); // đường dẫn đã chia sẻ không gãy
  assert.equal(u.description, 'Mô tả thử');
  assert.deepEqual(u.genres.map((g) => g.id).sort(), [genres[1].id, genres[2].id].sort());
  const found = await svc.listAdminMovies({ q: `ten moi ${RUN}`, page: 1, pageSize: 10 });
  assert.deepEqual(found.items.map((x) => x.id), [m.id]);
  assert.equal((await svc.listAdminMovies({ q: `ten cu ${RUN}`, page: 1, pageSize: 10 })).meta.total, 0);
});

test('⭐ đổi thời lượng bị chặn khi còn suất chiếu SẮP TỚI (RESOURCE_IN_USE); suất đã qua hoặc đã hủy thì không chặn', async () => {
  const m = await create(base({ title: `Thời Lượng ${RUN}` }));
  const past = await addShowtime(m.id, { startOffsetDays: -3 });
  const cancelled = await addShowtime(m.id, { startOffsetDays: 5, status: 'CANCELLED' });
  assert.equal((await svc.updateMovie({ movieId: m.id, durationMin: 120 })).durationMin, 120); // chỉ có suất đã qua / đã hủy
  const upcoming = await addShowtime(m.id, { startOffsetDays: 4 });
  assert.equal(await failCode(svc.updateMovie({ movieId: m.id, durationMin: 130 })), 'RESOURCE_IN_USE');
  assert.equal((await svc.updateMovie({ movieId: m.id, durationMin: 120 })).durationMin, 120); // không đổi giá trị: không sao
  assert.equal((await svc.updateMovie({ movieId: m.id, description: 'Đổi mô tả' })).description, 'Đổi mô tả'); // trường khác vẫn sửa được
  assert.ok(past.id && cancelled.id && upcoming.id);
});

test('⭐ ngừng chiếu (ENDED) bị chặn khi còn suất sắp tới; hủy suất xong thì được; có thể chuyển lại NOW_SHOWING', async () => {
  const m = await create(base({ title: `Ngừng Chiếu ${RUN}`, status: 'NOW_SHOWING' }));
  const st = await addShowtime(m.id, { startOffsetDays: 2 });
  assert.equal(await failCode(svc.setMovieStatus({ movieId: m.id, status: 'ENDED' })), 'RESOURCE_IN_USE');
  assert.equal((await svc.setMovieStatus({ movieId: m.id, status: 'COMING_SOON' })).status, 'COMING_SOON'); // đổi sang trạng thái khác thì không chặn
  await prisma.showtime.update({ where: { id: st.id }, data: { status: 'CANCELLED' } });
  assert.equal((await svc.setMovieStatus({ movieId: m.id, status: 'ENDED' })).status, 'ENDED');
  assert.equal((await svc.setMovieStatus({ movieId: m.id, status: 'NOW_SHOWING' })).status, 'NOW_SHOWING');
});

test('⭐ xóa phim: phim đã từng có suất (kể cả đã hủy) -> RESOURCE_IN_USE; phim chưa có suất xóa được, thể loại gắn theo cũng xóa', async () => {
  const used = await create(base({ title: `Đã Có Suất ${RUN}` }));
  await addShowtime(used.id, { startOffsetDays: -10, status: 'CANCELLED' });
  assert.equal(await failCode(svc.deleteMovie({ movieId: used.id })), 'RESOURCE_IN_USE');
  assert.ok(await prisma.movie.findUnique({ where: { id: used.id } }));

  const free = await create(base({ title: `Chưa Có Suất ${RUN}`, genreIds: [genres[0].id] }));
  await svc.deleteMovie({ movieId: free.id });
  assert.equal(await prisma.movie.findUnique({ where: { id: free.id } }), null);
  assert.equal(await prisma.movieGenre.count({ where: { movieId: free.id } }), 0);
  assert.equal(await failCode(svc.deleteMovie({ movieId: free.id })), 'NOT_FOUND');
});

test('danh sách admin thấy cả phim ENDED; lọc theo trạng thái; tìm không dấu; phim đổi trạng thái hiện đúng ở danh mục công khai', async () => {
  const m = await create(base({ title: `Công Khai ${RUN}`, status: 'ENDED' }));
  const list = await svc.listAdminMovies({ q: `cong khai ${RUN}`, status: 'ENDED', page: 1, pageSize: 10 });
  assert.deepEqual(list.items.map((x) => x.id), [m.id]);
  assert.equal((await svc.listAdminMovies({ q: `cong khai ${RUN}`, status: 'NOW_SHOWING', page: 1, pageSize: 10 })).meta.total, 0);
  assert.equal((await getMovieBySlug({ slug: m.slug })).title, m.title); // trang chi tiết công khai thấy phim mới tạo
});

test('HTTP: chỉ ADMIN; URL nguy hiểm, trường lạ (slug), dữ liệu sai bị 400; vòng đời tạo -> sửa -> trạng thái -> xóa (204)', async () => {
  const server = app.listen(0);
  const url = `http://localhost:${server.address().port}/api/v1/admin/movies`;
  const hdr = (role) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${roles.token(role)}` });
  const send = (method, path, role, body) => fetch(url + path, { method, headers: hdr(role), body: body && JSON.stringify(body) });
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await send('GET', '', 'USER')).status, 403);
    assert.equal((await send('POST', '', 'STAFF', base())).status, 403);

    const bad = (body) => send('POST', '', 'ADMIN', base(body)).then((r) => r.status);
    assert.equal(await bad({ posterUrl: 'javascript:alert(1)' }), 400); // chặn XSS qua URL
    assert.equal(await bad({ trailerUrl: 'data:text/html,<script>1</script>' }), 400);
    assert.equal(await bad({ slug: 'tu-dat-slug' }), 400); // slug do server sinh
    assert.equal(await bad({ durationMin: 0 }), 400);
    assert.equal(await bad({ ageRating: 'T21' }), 400);
    assert.equal(await bad({ releaseDate: '01/12/2026' }), 400);

    const made = await send('POST', '', 'ADMIN', base({ title: `Qua HTTP ${RUN}` }));
    assert.equal(made.status, 201);
    const m = (await made.json()).data;
    movieIds.add(m.id);
    assert.equal((await send('PUT', `/${m.id}`, 'ADMIN', { durationMin: 95 }).then((r) => r.json())).data.durationMin, 95);
    assert.equal((await send('PUT', `/${m.id}`, 'ADMIN', {})).status, 400);
    assert.equal((await send('PUT', `/${m.id}`, 'ADMIN', { status: 'ENDED' })).status, 400); // trạng thái đổi qua PATCH /status
    assert.equal((await send('PATCH', `/${m.id}/status`, 'ADMIN', { status: 'NOW_SHOWING' }).then((r) => r.json())).data.status, 'NOW_SHOWING');
    assert.equal((await send('PATCH', `/${m.id}/status`, 'ADMIN', { status: 'XYZ' })).status, 400);
    assert.equal((await send('GET', `/${m.id}`, 'ADMIN').then((r) => r.json())).data.slug, m.slug);
    assert.equal((await send('DELETE', `/${m.id}`, 'ADMIN')).status, 204);
    assert.equal((await send('GET', `/${m.id}`, 'ADMIN')).status, 404);
  } finally {
    server.close();
  }
});
