import { api } from './axios';

/** Danh sách có phân trang: trả { items, meta } (hợp đồng API mục 1.1). */
const unwrapPaged = (promise) => promise.then((res) => ({ items: res.data.data, meta: res.data.meta }));
const unwrap = (promise) => promise.then((res) => res.data.data);

/** @param {{ status?: 'NOW_SHOWING'|'COMING_SOON'|'ENDED', q?: string, genreId?: string, page?: number, pageSize?: number }} params */
export const listMovies = (params = {}) => unwrapPaged(api.get('/movies', { params }));
export const getMovie = (slug) => unwrap(api.get(`/movies/${encodeURIComponent(slug)}`));
export const listGenres = () => unwrap(api.get('/genres'));
export const listCities = () => unwrap(api.get('/cities'));
export const listBanners = () => unwrap(api.get('/banners'));
/** Rạp đang hoạt động, lọc được theo thành phố. */
export const listCinemas = (params = {}) => unwrap(api.get('/cinemas', { params }));
/** Lịch chiếu của một rạp trong một ngày (YYYY-MM-DD, giờ VN), nhóm theo phim -> định dạng — mẫu 3.2b. */
export const listCinemaShowtimes = ({ cinemaId, date }) => unwrap(api.get(`/cinemas/${cinemaId}/showtimes`, { params: { date } }));

/**
 * Lịch chiếu một phim trong một ngày, nhóm theo rạp → (định dạng, phụ đề/lồng tiếng) — mẫu 3.2 của hợp đồng.
 * @param {{ movieId: string, date: string, cityId: string }} params date: YYYY-MM-DD theo giờ Việt Nam
 */
export const listShowtimes = ({ movieId, date, cityId }) =>
  unwrap(api.get(`/movies/${movieId}/showtimes`, { params: { date, cityId } }));
