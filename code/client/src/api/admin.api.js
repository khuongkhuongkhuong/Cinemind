import { api } from './axios';

// API quản trị (/admin/*, chỉ ADMIN). Mọi hàm trả `data` (hoặc { items, meta } cho danh sách có phân trang).
const unwrap = (promise) => promise.then((res) => res.data.data);
const paged = (promise) => promise.then((res) => ({ items: res.data.data, meta: res.data.meta }));

// ---- Phim ----
export const listAdminMovies = (params) => paged(api.get('/admin/movies', { params }));
export const createMovie = (body) => unwrap(api.post('/admin/movies', body));
export const updateMovie = (id, body) => unwrap(api.put(`/admin/movies/${id}`, body));
export const setMovieStatus = (id, status) => unwrap(api.patch(`/admin/movies/${id}/status`, { status }));
export const deleteMovie = (id) => api.delete(`/admin/movies/${id}`).then(() => undefined);

// ---- Suất chiếu ----
export const listAdminShowtimes = (params) => paged(api.get('/admin/showtimes', { params }));
export const createShowtime = (body) => unwrap(api.post('/admin/showtimes', body));
export const updateShowtime = (id, body) => unwrap(api.put(`/admin/showtimes/${id}`, body));
export const cancelShowtime = (id) => unwrap(api.patch(`/admin/showtimes/${id}/cancel`));

// ---- Rạp & phòng (chỉ đọc) ----
export const listAdminCinemas = () => unwrap(api.get('/admin/cinemas'));
export const getRoomSeats = (roomId) => unwrap(api.get(`/admin/rooms/${roomId}/seats`));

// ---- Bảng giá ----
export const getPricing = () => unwrap(api.get('/admin/pricing'));
export const setPricing = (body) => unwrap(api.put('/admin/pricing', body));

// ---- Đơn hàng ----
export const listAdminOrders = (params) => paged(api.get('/admin/orders', { params }));
export const getAdminOrder = (id) => unwrap(api.get(`/admin/orders/${id}`));
export const refundOrder = (id) => unwrap(api.patch(`/admin/orders/${id}/refund`));
