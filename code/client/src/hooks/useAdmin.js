import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as adminApi from '@/api/admin.api';

// Danh sách luôn được làm mới sau khi tạo / sửa / xóa: invalidate theo "họ" khóa truy vấn.
const useListQuery = (key, fn, params) => useQuery({ queryKey: [key, params], queryFn: () => fn(params), placeholderData: keepPreviousData });

function useInvalidatingMutation(fn, keys) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => keys.forEach((k) => queryClient.invalidateQueries({ queryKey: [k] })),
  });
}

// Phim
export const useAdminMovies = (params) => useListQuery('adminMovies', adminApi.listAdminMovies, params);
export const useCreateMovie = () => useInvalidatingMutation(adminApi.createMovie, ['adminMovies', 'movies']);
export const useUpdateMovie = () => useInvalidatingMutation(({ id, body }) => adminApi.updateMovie(id, body), ['adminMovies', 'movies']);
export const useSetMovieStatus = () => useInvalidatingMutation(({ id, status }) => adminApi.setMovieStatus(id, status), ['adminMovies', 'movies']);
export const useDeleteMovie = () => useInvalidatingMutation(adminApi.deleteMovie, ['adminMovies', 'movies']);

// Suất chiếu
export const useAdminShowtimes = (params) => useListQuery('adminShowtimes', adminApi.listAdminShowtimes, params);
export const useCreateShowtime = () => useInvalidatingMutation(adminApi.createShowtime, ['adminShowtimes', 'showtimes']);
export const useUpdateShowtime = () => useInvalidatingMutation(({ id, body }) => adminApi.updateShowtime(id, body), ['adminShowtimes', 'showtimes']);
export const useCancelShowtime = () => useInvalidatingMutation(adminApi.cancelShowtime, ['adminShowtimes', 'showtimes']);

// Rạp & phòng
export const useAdminCinemas = () => useQuery({ queryKey: ['adminCinemas'], queryFn: adminApi.listAdminCinemas, staleTime: 5 * 60_000 });
export const useRoomSeats = (roomId) => useQuery({ queryKey: ['roomSeats', roomId], queryFn: () => adminApi.getRoomSeats(roomId), enabled: Boolean(roomId) });

// Bảng giá
export const usePricing = () => useQuery({ queryKey: ['pricing'], queryFn: adminApi.getPricing, staleTime: 0 });
export const useSetPricing = () => useInvalidatingMutation(adminApi.setPricing, ['pricing']);

// Đơn hàng
export const useAdminOrders = (params) => useListQuery('adminOrders', adminApi.listAdminOrders, params);
export const useAdminOrder = (id) => useQuery({ queryKey: ['adminOrder', id], queryFn: () => adminApi.getAdminOrder(id), enabled: Boolean(id), staleTime: 0 });
export const useRefundOrder = () => useInvalidatingMutation(adminApi.refundOrder, ['adminOrders', 'adminOrder']);

// Báo cáo doanh thu
export const useRevenue = (params) => useQuery({ queryKey: ['revenue', params], queryFn: () => adminApi.getRevenue(params), placeholderData: keepPreviousData });

// Combo
export const useAdminCombos = () => useQuery({ queryKey: ['adminCombos'], queryFn: adminApi.listAdminCombos });
export const useCreateCombo = () => useInvalidatingMutation(adminApi.createCombo, ['adminCombos', 'combos']);
export const useUpdateCombo = () => useInvalidatingMutation(({ id, body }) => adminApi.updateCombo(id, body), ['adminCombos', 'combos']);
export const useDeleteCombo = () => useInvalidatingMutation(adminApi.deleteCombo, ['adminCombos', 'combos']);

// Khuyến mãi
export const useAdminPromotions = () => useQuery({ queryKey: ['adminPromotions'], queryFn: adminApi.listAdminPromotions });
export const useCreatePromotion = () => useInvalidatingMutation(adminApi.createPromotion, ['adminPromotions']);
export const useUpdatePromotion = () => useInvalidatingMutation(({ id, body }) => adminApi.updatePromotion(id, body), ['adminPromotions']);
export const useDeletePromotion = () => useInvalidatingMutation(adminApi.deletePromotion, ['adminPromotions']);

// Banner
export const useAdminBanners = () => useQuery({ queryKey: ['adminBanners'], queryFn: adminApi.listAdminBanners });
export const useCreateBanner = () => useInvalidatingMutation(adminApi.createBanner, ['adminBanners', 'banners']);
export const useUpdateBanner = () => useInvalidatingMutation(({ id, body }) => adminApi.updateBanner(id, body), ['adminBanners', 'banners']);
export const useDeleteBanner = () => useInvalidatingMutation(adminApi.deleteBanner, ['adminBanners', 'banners']);

// Người dùng
export const useAdminUsers = (params) => useListQuery('adminUsers', adminApi.listAdminUsers, params);
export const useCreateStaff = () => useInvalidatingMutation(adminApi.createStaff, ['adminUsers']);
export const useUpdateUser = () => useInvalidatingMutation(({ id, body }) => adminApi.updateUser(id, body), ['adminUsers']);

// Rạp (tạo / sửa)
export const useCreateCinema = () => useInvalidatingMutation(adminApi.createCinema, ['adminCinemas', 'cinemas']);
export const useUpdateCinema = () => useInvalidatingMutation(({ id, body }) => adminApi.updateCinema(id, body), ['adminCinemas', 'cinemas', 'cinemaShowtimes']);

// Nhật ký thao tác
export const useAuditLogs = (params) => useListQuery('auditLogs', adminApi.listAuditLogs, params);
