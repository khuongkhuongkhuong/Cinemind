import { useQuery } from '@tanstack/react-query';
import * as authApi from '@/api/auth.api';

/** Thông tin mới nhất của chính mình (điểm thay đổi sau khi thanh toán nên không dùng bản lưu lúc đăng nhập). */
export const useMe = ({ enabled }) => useQuery({ queryKey: ['me'], queryFn: authApi.me, enabled, staleTime: 0 });
