// Chuyển dữ liệu TMDB (themoviedb.org) thành đúng hình dạng của prisma/seed-data/movies.json.
// Tách riêng khỏi script chạy để test được mà không cần mạng hay khóa API (truyền `get` giả).

const API = 'https://api.themoviedb.org/3';
const IMAGE = 'https://image.tmdb.org/t/p';
const AGE_RATINGS = ['P', 'K', 'T13', 'T16', 'T18'];
const LANGUAGES = {
  vi: 'Tiếng Việt', en: 'Tiếng Anh', ko: 'Tiếng Hàn', ja: 'Tiếng Nhật', zh: 'Tiếng Trung', cn: 'Tiếng Quảng Đông',
  th: 'Tiếng Thái', de: 'Tiếng Đức', ru: 'Tiếng Nga', fr: 'Tiếng Pháp', es: 'Tiếng Tây Ban Nha', hi: 'Tiếng Hindi', id: 'Tiếng Indonesia',
};

/**
 * Hàm gọi TMDB. Nhận cả hai loại khóa TMDB cấp: "API Key" (v3, đưa vào query) và "API Read Access Token" (bắt đầu bằng eyJ, đưa vào header).
 * Lỗi chỉ nêu đường dẫn + mã HTTP, không bao giờ kèm URL đầy đủ vì URL chứa khóa.
 */
export function createTmdbGet(key, fetchImpl = fetch) {
  const isToken = key.startsWith('eyJ');
  return async (path, params = {}) => {
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (!isToken) url.searchParams.set('api_key', key);
    const res = await fetchImpl(url, { headers: isToken ? { Authorization: `Bearer ${key}` } : {} });
    if (!res.ok) throw new Error(`TMDB ${path} trả lỗi HTTP ${res.status}${res.status === 401 ? ' (kiểm tra lại TMDB_API_KEY)' : ''}`);
    return res.json();
  };
}

const cut = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

// TMDB tiếng Việt đặt tên thể loại kiểu "Phim Hành Động" -> "Hành Động".
export const genreName = (name) => name.replace(/^Phim\s+/i, '').trim();

const vnReleases = (detail) => detail.release_dates?.results?.find((r) => r.iso_3166_1 === 'VN')?.release_dates ?? [];

/** Ngày khởi chiếu tại Việt Nam (chiếu rạp: type 2, 3); không có thì lấy ngày phát hành chung. */
export function releaseDateOf(detail) {
  const theatrical = vnReleases(detail).filter((r) => r.type === 2 || r.type === 3).map((r) => r.release_date.slice(0, 10)).sort();
  return theatrical.at(-1) ?? detail.release_date ?? '';
}

/** Phân loại độ tuổi của Việt Nam; TMDB thường thiếu -> trả null để người chạy biết mà kiểm tra tay. */
export function ageRatingOf(detail) {
  return vnReleases(detail).map((r) => r.certification?.trim().toUpperCase()).find((c) => AGE_RATINGS.includes(c)) ?? null;
}

// Quy đổi phân loại nước ngoài -> mức gần nhất của Việt Nam, chỉ để ƯỚC LƯỢNG khi thiếu phân loại VN. Xét lần lượt từng nước.
const FOREIGN_RATINGS = [
  ['US', { G: 'P', PG: 'K', 'PG-13': 'T13', R: 'T18', 'NC-17': 'T18' }],
  ['GB', { U: 'P', PG: 'K', '12A': 'T13', 12: 'T13', 15: 'T16', 18: 'T18' }],
  ['KR', { ALL: 'P', 12: 'T13', 15: 'T16', 18: 'T18', 19: 'T18' }],
  ['DE', { 0: 'P', 6: 'K', 12: 'T13', 16: 'T16', 18: 'T18' }],
];

/** @returns {{ rating: string, country: string } | null} */
export function estimatedAgeRatingOf(detail) {
  for (const [country, table] of FOREIGN_RATINGS) {
    const releases = detail.release_dates?.results?.find((r) => r.iso_3166_1 === country)?.release_dates ?? [];
    const rating = releases.map((r) => table[r.certification?.trim().toUpperCase()]).find(Boolean);
    if (rating) return { rating, country };
  }
  return null;
}

export function trailerOf(videos = []) {
  const youtube = videos.filter((v) => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'));
  const score = (v) => (v.type === 'Trailer' ? 4 : 0) + (v.iso_639_1 === 'vi' ? 2 : 0) + (v.official ? 1 : 0);
  const best = youtube.sort((a, b) => score(b) - score(a))[0];
  return best ? `https://www.youtube.com/watch?v=${best.key}` : null;
}

/**
 * Một phim chi tiết (kèm credits, videos, release_dates) -> bản ghi seed.
 * @returns {{ movie: object, warnings: string[] } | { skip: string }}
 */
export function toSeedMovie(detail, { status, fallbackOverview = '' }) {
  const title = (detail.title || detail.original_title || '').trim();
  const description = (detail.overview || fallbackOverview || '').trim();
  const releaseDate = releaseDateOf(detail);
  if (!title) return { skip: `#${detail.id}: không có tên` };
  if (detail.adult) return { skip: `${title}: phim người lớn` };
  if (!detail.poster_path) return { skip: `${title}: không có poster` };
  if (!description) return { skip: `${title}: không có mô tả` };
  if (!releaseDate) return { skip: `${title}: không có ngày khởi chiếu` };
  if (!detail.genres?.length) return { skip: `${title}: không có thể loại` };
  // Phim đang chiếu phải có thời lượng thật (dùng để tính giờ kết thúc suất); phim sắp chiếu thiếu thì tạm 120 phút.
  if (!detail.runtime && status === 'NOW_SHOWING') return { skip: `${title}: chưa có thời lượng` };

  const warnings = [];
  if (!detail.runtime) warnings.push(`${title}: chưa có thời lượng, tạm đặt 120 phút`);
  let ageRating = ageRatingOf(detail);
  if (!ageRating) {
    const estimate = estimatedAgeRatingOf(detail);
    ageRating = estimate?.rating ?? 'T13';
    warnings.push(estimate
      ? `${title}: thiếu phân loại tuổi VN, ước lượng ${ageRating} theo phân loại ${estimate.country}`
      : `${title}: không có phân loại tuổi nào, tạm đặt T13`);
  }

  const directors = (detail.credits?.crew ?? []).filter((c) => c.job === 'Director').map((c) => c.name);
  const actors = [...(detail.credits?.cast ?? [])].sort((a, b) => a.order - b.order).slice(0, 6).map((c) => c.name);

  return {
    warnings,
    movie: {
      tmdbId: detail.id,
      title: cut(title, 200),
      genres: detail.genres.slice(0, 3).map((g) => genreName(g.name)),
      durationMin: detail.runtime || 120,
      ageRating,
      status,
      releaseDate,
      language: LANGUAGES[detail.original_language] ?? null,
      description: cut(description, 5000),
      director: cut(directors.join(', '), 200) || null,
      actors: cut(actors.join(', '), 500) || null,
      posterUrl: `${IMAGE}/w500${detail.poster_path}`,
      backdropUrl: detail.backdrop_path ? `${IMAGE}/w1280${detail.backdrop_path}` : null,
      trailerUrl: trailerOf(detail.videos?.results),
    },
  };
}

/**
 * Lấy phim đang chiếu + sắp chiếu tại Việt Nam.
 * Trạng thái quyết định theo NGÀY KHỞI CHIẾU so với `today` (YYYY-MM-DD), không theo danh sách TMDB trả về.
 */
export async function collectMovies({ get, today, maxNowShowing = 15, maxComingSoon = 8, pages = 3 }) {
  const ids = new Set();
  for (const list of ['/movie/now_playing', '/movie/upcoming']) {
    for (let page = 1; page <= pages; page++) {
      const data = await get(list, { language: 'vi-VN', region: 'VN', page });
      for (const m of data.results ?? []) ids.add(m.id);
      if (page >= (data.total_pages ?? 1)) break;
    }
  }

  const found = { NOW_SHOWING: [], COMING_SOON: [] };
  const skipped = [];
  for (const id of ids) {
    const detail = await get(`/movie/${id}`, { language: 'vi-VN', append_to_response: 'credits,videos,release_dates', include_video_language: 'vi,en,null' });
    const status = releaseDateOf(detail) <= today ? 'NOW_SHOWING' : 'COMING_SOON';
    const fallbackOverview = detail.overview ? '' : (await get(`/movie/${id}`, { language: 'en-US' })).overview;
    const result = toSeedMovie(detail, { status, fallbackOverview });
    if (result.skip) skipped.push(result.skip);
    else found[status].push({ ...result, popularity: detail.popularity ?? 0 });
  }

  const top = (list, max) => list.sort((a, b) => b.popularity - a.popularity).slice(0, max);
  const picked = [...top(found.NOW_SHOWING, maxNowShowing), ...top(found.COMING_SOON, maxComingSoon)];
  const movies = picked.map((p) => p.movie);
  return {
    genres: [...new Set(movies.flatMap((m) => m.genres))].sort((a, b) => a.localeCompare(b, 'vi')),
    movies,
    warnings: picked.flatMap((p) => p.warnings),
    skipped,
  };
}
