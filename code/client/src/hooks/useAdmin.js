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
