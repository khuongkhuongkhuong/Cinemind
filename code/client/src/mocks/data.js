// Dữ liệu giả cho MSW, đúng hình dạng JSON mẫu trong docs/04-api-contract.md (mục 3). Khi backend thật chạy thì không dùng.
export const genres = [
  { id: 'g1000000-0000-4000-8000-000000000001', name: 'Hành động' },
  { id: 'g1000000-0000-4000-8000-000000000002', name: 'Hài' },
  { id: 'g1000000-0000-4000-8000-000000000003', name: 'Tình cảm' },
];

const movie = (n, title, ageRating, durationMin, status, g) => ({
  id: `m1000000-0000-4000-8000-00000000000${n}`,
  title,
  slug: title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-'),
  posterUrl: null,
  durationMin,
  ageRating,
  status,
  releaseDate: '2026-09-12',
  genres: [genres[g]],
});

export const movies = [
  movie(1, 'Nhà Bà Tư', 'T13', 102, 'NOW_SHOWING', 1),
  movie(2, 'Cú Nhảy Cuối Cùng', 'T16', 128, 'NOW_SHOWING', 0),
  movie(3, 'Mùa Hè Của Mây', 'T13', 115, 'NOW_SHOWING', 2),
  movie(4, 'Thế Giới Bong Bóng', 'P', 92, 'NOW_SHOWING', 1),
  movie(5, 'Tết Này Về Quê', 'P', 100, 'COMING_SOON', 1),
];

export const user = { id: 'u1000000-0000-4000-8000-000000000001', email: 'user@cinemind.vn', fullName: 'Khách hàng mẫu', phone: null, role: 'USER', points: 0 };
export const cities = [
  { id: 'c1000000-0000-4000-8000-000000000001', name: 'Hà Nội' },
  { id: 'c1000000-0000-4000-8000-000000000002', name: 'Hồ Chí Minh' },
];

export const movieDetail = (m) => ({
  ...m,
  description: `${m.title} — phim dữ liệu giả của chế độ MSW.`,
  director: 'Đạo diễn mẫu',
  actors: 'Diễn viên A, Diễn viên B',
  language: 'Tiếng Việt',
  trailerUrl: null,
});

/** Lịch chiếu giả theo mẫu 3.2 của hợp đồng: một suất đã đóng bán, hai suất còn mở. */
export const schedule = (date) => ({
  date,
  cinemas: [{
    cinema: { id: 'cn100000-0000-4000-8000-000000000001', name: 'Cinemind Cầu Giấy', address: '102 Cầu Giấy, Hà Nội' },
    groups: [
      { format: 'F2D', audio: 'SUBTITLE', showtimes: [
        { id: 's1000000-0000-4000-8000-000000000001', startTime: `${date}T02:30:00.000Z`, isOpenForSale: false },
        { id: 's1000000-0000-4000-8000-000000000002', startTime: `${date}T11:45:00.000Z`, isOpenForSale: true },
      ] },
      { format: 'F3D', audio: 'DUBBED', showtimes: [{ id: 's1000000-0000-4000-8000-000000000003', startTime: `${date}T14:00:00.000Z`, isOpenForSale: true }] },
    ],
  }],
});
