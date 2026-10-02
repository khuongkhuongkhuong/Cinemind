import { keepPreviousData, useQuery } from '@tanstack/react-query';
import * as catalogApi from '@/api/catalog.api';

/** Danh sách phim (lọc theo trạng thái / tên / thể loại, phân trang). Giữ dữ liệu cũ khi đổi trang để khỏi nhấp nháy. */
export const useMovies = (params = {}) =>
  useQuery({ queryKey: ['movies', params], queryFn: () => catalogApi.listMovies(params), placeholderData: keepPreviousData });

export const useMovie = (slug) =>
  useQuery({ queryKey: ['movie', slug], queryFn: () => catalogApi.getMovie(slug), enabled: Boolean(slug) });

export const useGenres = () => useQuery({ queryKey: ['genres'], queryFn: catalogApi.listGenres, staleTime: 10 * 60_000 });
export const useCities = () => useQuery({ queryKey: ['cities'], queryFn: catalogApi.listCities, staleTime: 10 * 60_000 });
export const useBanners = () => useQuery({ queryKey: ['banners'], queryFn: catalogApi.listBanners, staleTime: 5 * 60_000 });

/** Lịch chiếu của một phim theo ngày + thành phố. Chỉ chạy khi đã chọn đủ cả ba. Làm mới mỗi phút (suất có thể đóng bán). */
export const useShowtimes = ({ movieId, date, cityId }) =>
  useQuery({
    queryKey: ['showtimes', movieId, date, cityId],
    queryFn: () => catalogApi.listShowtimes({ movieId, date, cityId }),
    enabled: Boolean(movieId && date && cityId),
    refetchInterval: 60_000,
  });
