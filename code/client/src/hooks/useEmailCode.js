// Xác minh email và quên mật khẩu (FR-18a, FR-18b).
import { useMutation } from '@tanstack/react-query';
import * as authApi from '@/api/auth.api';
import { useAuth } from '@/hooks/useAuth';

/** Xác minh thành công thì cập nhật ngay người dùng đang đăng nhập (dải nhắc biến mất). */
export function useVerifyEmail() {
  const { updateUser } = useAuth();
  return useMutation({ mutationFn: authApi.verifyEmail, onSuccess: updateUser });
}

export const useResendCode = () => useMutation({ mutationFn: authApi.resendCode });
export const useForgotPassword = () => useMutation({ mutationFn: authApi.forgotPassword });
export const useResetPassword = () => useMutation({ mutationFn: authApi.resetPassword });
