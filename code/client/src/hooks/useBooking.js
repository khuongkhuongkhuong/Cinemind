import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as bookingApi from '@/api/booking.api';

/**
 * Sơ đồ ghế. Tự làm mới mỗi 12 giây (NFR-12) để người dùng thấy ghế người khác vừa giữ; cũng làm mới khi quay lại tab.
 * Không dùng staleTime dài: dữ liệu này đổi liên tục.
 */
export const useSeatMap = (showtimeId) =>
  useQuery({
    queryKey: ['seatMap', showtimeId],
    queryFn: () => bookingApi.getSeatMap(showtimeId),
    enabled: Boolean(showtimeId),
    refetchInterval: 12_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

export const useOrder = (orderId) =>
  useQuery({ queryKey: ['order', orderId], queryFn: () => bookingApi.getOrder(orderId), enabled: Boolean(orderId), staleTime: 0 });

export const useCombos = () => useQuery({ queryKey: ['combos'], queryFn: bookingApi.listCombos, staleTime: 5 * 60_000 });

export const useCreateOrder = () => useMutation({ mutationFn: bookingApi.createOrder });

/** Mọi thao tác trên đơn trả về `Order` mới (tổng tiền do server tính): đặt thẳng vào bộ nhớ đệm để giao diện hiển thị ngay. */
function useOrderMutation(fn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (order) => queryClient.setQueryData(['order', order.id], order),
  });
}
export const useSetCombos = () => useOrderMutation(({ orderId, items }) => bookingApi.setCombos(orderId, items));
export const useApplyPromotion = () => useOrderMutation(({ orderId, code }) => bookingApi.applyPromotion(orderId, code));
export const useRemovePromotion = () => useOrderMutation(({ orderId }) => bookingApi.removePromotion(orderId));
export const useCancelOrder = () => useOrderMutation(({ orderId }) => bookingApi.cancelOrder(orderId));

export const useCreatePayment = () => useMutation({ mutationFn: ({ orderId }) => bookingApi.createPayment(orderId) });
