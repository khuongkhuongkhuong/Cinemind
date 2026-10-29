import { useMutation } from '@tanstack/react-query';
import * as meApi from '@/api/me.api';

// Hồ sơ cá nhân: cập nhật thông tin và đổi mật khẩu (userId luôn lấy từ token ở server).
export const useUpdateProfile = () => useMutation({ mutationFn: meApi.updateProfile });
export const useChangePassword = () => useMutation({ mutationFn: meApi.changePassword });
