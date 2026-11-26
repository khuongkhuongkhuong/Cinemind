// Chuyển đổi dữ liệu TMDB -> dữ liệu seed. KHÔNG gọi mạng, không cần khóa, không cần database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectMovies, createTmdbGet, genreName, releaseDateOf, toSeedMovie, trailerOf } from '../scripts/lib/tmdb.js';

const detail = (extra = {}) => ({
  id: 1, title: 'Phim A', overview: 'Mô tả', runtime: 100, poster_path: '/a.jpg', backdrop_path: '/b.jpg',
  release_date: '2026-11-01', original_language: 'ko', popularity: 5,
  genres: [{ name: 'Phim Hành Động' }, { name: 'Phim Hài' }],
  credits: { crew: [{ job: 'Producer', name: 'P' }, { job: 'Director', name: 'Đạo Diễn' }], cast: [{ order: 1, name: 'Hai' }, { order: 0, name: 'Một' }] },
  videos: { results: [] },
  release_dates: { results: [{ iso_3166_1: 'VN', release_dates: [{ type: 3, release_date: '2026-11-13T00:00:00.000Z', certification: 'T16' }] }] },
  ...extra,
});

test('chuyển một phim: đúng trường, ảnh là URL https, diễn viên theo thứ tự vai', () => {
  const { movie, warnings } = toSeedMovie(detail(), { status: 'NOW_SHOWING' });
  assert.deepEqual(warnings, []);
  assert.deepEqual(movie.genres, ['Hành Động', 'Hài']);
  assert.equal(movie.director, 'Đạo Diễn');
  assert.equal(movie.actors, 'Một, Hai');
  assert.equal(movie.language, 'Tiếng Hàn');
  assert.equal(movie.ageRating, 'T16');
  assert.equal(movie.releaseDate, '2026-11-13'); // ngày chiếu tại VN thắng ngày phát hành chung
  assert.equal(movie.posterUrl, 'https://image.tmdb.org/t/p/w500/a.jpg');
  assert.equal(movie.backdropUrl, 'https://image.tmdb.org/t/p/w1280/b.jpg');
});

test('thiếu phân loại tuổi VN -> T13 kèm cảnh báo; chứng nhận lạ (C, R) bị bỏ qua', () => {
  for (const certification of ['', 'C', 'R']) {
    const d = detail({ release_dates: { results: [{ iso_3166_1: 'VN', release_dates: [{ type: 3, release_date: '2026-11-13', certification }] }] } });
    const { movie, warnings } = toSeedMovie(d, { status: 'NOW_SHOWING' });
    assert.equal(movie.ageRating, 'T13');
    assert.equal(warnings.length, 1);
  }
});

test('thiếu phân loại VN thì ước lượng theo nước ngoài (Mỹ trước), có nêu nguồn trong cảnh báo', () => {
  const of = (pairs) => detail({ release_dates: { results: pairs.map(([c, certification]) => ({ iso_3166_1: c, release_dates: [{ type: 3, release_date: '2026-11-13', certification }] })) } });
  const run = (pairs) => toSeedMovie(of(pairs), { status: 'NOW_SHOWING' });
  assert.equal(run([['KR', '15'], ['US', 'R']]).movie.ageRating, 'T18');
  assert.equal(run([['US', 'NR'], ['KR', '15']]).movie.ageRating, 'T16'); // "chưa phân loại" thì xét nước kế
  assert.equal(run([['US', 'PG']]).movie.ageRating, 'K');
  assert.match(run([['GB', '18']]).warnings[0], /ước lượng T18 theo phân loại GB/);
  assert.equal(run([['VN', 'P'], ['US', 'R']]).movie.ageRating, 'P'); // có phân loại VN thì luôn dùng
});

test('phim thiếu dữ liệu bị loại; riêng phim sắp chiếu được thiếu thời lượng', () => {
  for (const bad of [{ poster_path: null }, { overview: '' }, { genres: [] }, { adult: true }, { runtime: 0 }]) {
    assert.ok(toSeedMovie(detail(bad), { status: 'NOW_SHOWING' }).skip, JSON.stringify(bad));
  }
  assert.equal(toSeedMovie(detail({ runtime: 0 }), { status: 'COMING_SOON' }).movie.durationMin, 120);
  assert.equal(toSeedMovie(detail({ overview: '' }), { status: 'NOW_SHOWING', fallbackOverview: 'English' }).movie.description, 'English');
});

test('cắt theo giới hạn của form quản trị (mô tả 5000 ký tự)', () => {
  assert.equal(toSeedMovie(detail({ overview: 'x'.repeat(6000) }), { status: 'NOW_SHOWING' }).movie.description.length, 5000);
});

test('không có ngày chiếu VN thì dùng ngày phát hành chung; bỏ qua lịch không phải chiếu rạp', () => {
  assert.equal(releaseDateOf(detail({ release_dates: { results: [] } })), '2026-11-01');
  const digitalOnly = detail({ release_dates: { results: [{ iso_3166_1: 'VN', release_dates: [{ type: 4, release_date: '2027-01-01' }] }] } });
  assert.equal(releaseDateOf(digitalOnly), '2026-11-01');
});

test('trailer: ưu tiên Trailer hơn Teaser, tiếng Việt hơn tiếng Anh, chỉ YouTube', () => {
  const v = (key, type, lang, site = 'YouTube') => ({ key, type, iso_639_1: lang, site });
  assert.equal(trailerOf([v('t', 'Teaser', 'vi'), v('en', 'Trailer', 'en'), v('vi', 'Trailer', 'vi'), v('x', 'Trailer', 'vi', 'Vimeo')]), 'https://www.youtube.com/watch?v=vi');
  assert.equal(trailerOf([v('c', 'Clip', 'vi')]), null);
  assert.equal(genreName('Phim Gia Đình'), 'Gia Đình');
});

test('gom danh sách: không trùng, phân trạng thái theo ngày, giữ phim phổ biến nhất', async () => {
  const movies = {
    1: detail({ id: 1, title: 'Cũ ít xem', popularity: 1 }),
    2: detail({ id: 2, title: 'Cũ nhiều xem', popularity: 9 }),
    3: detail({ id: 3, title: 'Tương lai', release_dates: { results: [] }, release_date: '2027-01-01' }),
    4: detail({ id: 4, title: 'Thiếu poster', poster_path: null }),
  };
  const get = async (path) => (path.startsWith('/movie/now') || path.startsWith('/movie/up')
    ? { results: Object.keys(movies).map((id) => ({ id: Number(id) })), total_pages: 1 }
    : movies[path.split('/')[2]]);
  const out = await collectMovies({ get, today: '2026-11-26', maxNowShowing: 1 });
  assert.deepEqual(out.movies.map((m) => [m.title, m.status]), [['Cũ nhiều xem', 'NOW_SHOWING'], ['Tương lai', 'COMING_SOON']]);
  assert.equal(out.skipped.length, 1);
});

test('khóa: API Key đi vào query, Read Access Token đi vào header; lỗi không để lộ khóa', async () => {
  const seen = [];
  const ok = async (url, options) => { seen.push({ url: String(url), options }); return { ok: true, json: async () => ({}) }; };
  await createTmdbGet('khoa-v3', ok)('/movie/1', { language: 'vi-VN' });
  await createTmdbGet('eyJtoken', ok)('/movie/1');
  assert.match(seen[0].url, /api_key=khoa-v3/);
  assert.equal(seen[1].url.includes('eyJtoken'), false);
  assert.equal(seen[1].options.headers.Authorization, 'Bearer eyJtoken');
  const denied = createTmdbGet('bi-mat', async () => ({ ok: false, status: 401 }));
  await assert.rejects(denied('/movie/1'), (e) => e.message.includes('401') && !e.message.includes('bi-mat'));
});
