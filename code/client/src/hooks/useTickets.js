import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import * as meApi from '@/api/me.api';
import * as staffApi from '@/api/staff.api';

export const useMyOrders = (params) =>
  useQuery({ queryKey: ['myOrders', params], queryFn: () => meApi.listMyOrders(params), placeholderData: keepPreviousData });

export const useMyTicket = (code) =>
  useQuery({ queryKey: ['myTicket', code], queryFn: () => meApi.getMyTicket(code), enabled: Boolean(code), staleTime: 0 });

export const useLookupTicket = () => useMutation({ mutationFn: staffApi.lookupTicket });
export const useCheckIn = () => useMutation({ mutationFn: staffApi.checkIn });
