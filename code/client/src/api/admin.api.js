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

// ---- Báo cáo ----
/** @param {{ from?: string, to?: string, groupBy?: 'day'|'movie'|'cinema' }} params from/to: YYYY-MM-DD (giờ VN) */
export const getRevenue = (params) => unwrap(api.get('/admin/reports/revenue', { params }));

// ---- Combo ----
export const listAdminCombos = () => unwrap(api.get('/admin/combos'));
export const createCombo = (body) => unwrap(api.post('/admin/combos', body));
export const updateCombo = (id, body) => unwrap(api.put(`/admin/combos/${id}`, body));
export const deleteCombo = (id) => api.delete(`/admin/combos/${id}`).then(() => undefined);

// ---- Khuyến mãi ----
export const listAdminPromotions = () => unwrap(api.get('/admin/promotions'));
export const createPromotion = (body) => unwrap(api.post('/admin/promotions', body));
export const updatePromotion = (id, body) => unwrap(api.put(`/admin/promotions/${id}`, body));
export const deletePromotion = (id) => api.delete(`/admin/promotions/${id}`).then(() => undefined);

// ---- Banner ----
export const listAdminBanners = () => unwrap(api.get('/admin/banners'));
export const createBanner = (body) => unwrap(api.post('/admin/banners', body));
export const updateBanner = (id, body) => unwrap(api.put(`/admin/banners/${id}`, body));
export const deleteBanner = (id) => api.delete(`/admin/banners/${id}`).then(() => undefined);

// ---- Người dùng ----
export const listAdminUsers = (params) => paged(api.get('/admin/users', { params }));
export const createStaff = (body) => unwrap(api.post('/admin/users', body));
/** @param {{ role?: 'USER'|'STAFF'|'ADMIN', isActive?: boolean }} body */
export const updateUser = (id, body) => unwrap(api.patch(`/admin/users/${id}`, body));

// ---- Tạo / sửa rạp (v1.20) ----
export const createCinema = (body) => unwrap(api.post('/admin/cinemas', body));
export const updateCinema = (id, body) => unwrap(api.put(`/admin/cinemas/${id}`, body));

// ---- Nhật ký thao tác (v1.21) ----
export const listAuditLogs = (params) => paged(api.get('/admin/audit-logs', { params }));
