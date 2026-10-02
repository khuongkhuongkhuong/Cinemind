import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as authApi from '@/api/auth.api';
import { refreshAccessToken } from '@/api/axios';
import { hasSessionHint, onSessionExpired, setAccessToken, setSessionHint } from '@/api/tokenStore';

export const AuthContext = createContext(null);

let restoring = null;
/**
 * Khôi phục phiên khi mở / tải lại trang: dùng cookie refresh lấy access token mới rồi hỏi "tôi là ai".
 * Dùng chung MỘT lời gọi đang chạy: React StrictMode (chế độ dev) chạy effect hai lần, mà server xoay vòng refresh token
 * nên gọi hai lần song song sẽ làm lần sau bị từ chối.
 */
function restoreSession() {
  if (!hasSessionHint()) return Promise.resolve(null); // chưa từng đăng nhập trên trình duyệt này: khỏi gọi server
  restoring ??= (async () => {
    try {
      await refreshAccessToken();
      return await authApi.me();
    } catch {
      setSessionHint(false); // cookie hết hạn / bị thu hồi
      return null;
    }
  })().finally(() => { restoring = null; });
  return restoring;
}

/**
 * Trạng thái đăng nhập toàn ứng dụng.
 * status: 'loading' (đang khôi phục phiên) | 'authenticated' | 'anonymous'
 */
export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState({ status: 'loading', user: null });

  useEffect(() => {
    let alive = true;
    restoreSession().then((user) => {
      if (alive) setState(user ? { status: 'authenticated', user } : { status: 'anonymous', user: null });
    });
    return () => { alive = false; };
  }, []);

  // Refresh thất bại giữa chừng (cookie hết hạn / bị thu hồi): về trạng thái chưa đăng nhập.
  useEffect(() => onSessionExpired(() => {
    queryClient.clear(); // không để dữ liệu của người cũ còn trong bộ nhớ đệm
    setSessionHint(false);
    setState({ status: 'anonymous', user: null });
  }), [queryClient]);

  const finishLogin = useCallback(({ user, accessToken }) => {
    setAccessToken(accessToken);
    setSessionHint(true);
    queryClient.clear();
    setState({ status: 'authenticated', user });
    return user;
  }, [queryClient]);

  const login = useCallback((credentials) => authApi.login(credentials).then(finishLogin), [finishLogin]);
  const register = useCallback((body) => authApi.register(body).then(finishLogin), [finishLogin]);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Dù server báo lỗi (vd token đã hết hạn), phía client vẫn đăng xuất để người dùng không bị kẹt.
    }
    setAccessToken(null);
    setSessionHint(false);
    queryClient.clear();
    setState({ status: 'anonymous', user: null });
  }, [queryClient]);

  /** Cập nhật thông tin người dùng sau khi sửa hồ sơ. */
  const updateUser = useCallback((user) => setState((s) => ({ ...s, user })), []);

  const value = useMemo(() => ({ ...state, login, register, logout, updateUser }), [state, login, register, logout, updateUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
