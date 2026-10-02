import axios from 'axios';
import { emitSessionExpired, getAccessToken, setAccessToken } from './tokenStore';

const baseURL = import.meta.env.VITE_API_URL || '/api/v1';

/** Axios chính: tự gắn Bearer token, tự refresh khi gặp 401 TOKEN_EXPIRED. `withCredentials` để gửi / nhận cookie refresh. */
export const api = axios.create({ baseURL, withCredentials: true });

/** Axios "trần" không qua interceptor, dành cho gọi refresh (tránh vòng lặp vô tận khi chính refresh bị 401). */
const bare = axios.create({ baseURL, withCredentials: true });

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing = null;

/**
 * Đổi cookie refresh lấy access token mới. "Single-flight": nhiều request cùng hết hạn một lúc chỉ gọi refresh MỘT lần
 * và dùng chung kết quả. Bắt buộc, vì server xoay vòng refresh token (mỗi token chỉ dùng một lần): gọi hai lần song song
 * với cùng một cookie thì lần thứ hai bị từ chối và người dùng bị đăng xuất oan.
 * @returns {Promise<string>} access token mới
 */
export function refreshAccessToken() {
  refreshing ??= bare.post('/auth/refresh')
    .then((res) => {
      const token = res.data.data.accessToken;
      setAccessToken(token);
      return token;
    })
    .finally(() => { refreshing = null; });
  return refreshing;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { config, response } = error;
    const expired = response?.status === 401 && response.data?.error?.code === 'TOKEN_EXPIRED';
    if (!expired || !config || config._retried) throw error;

    config._retried = true; // mỗi request chỉ thử lại đúng một lần
    try {
      await refreshAccessToken();
    } catch {
      setAccessToken(null);
      emitSessionExpired(); // AuthContext đưa người dùng về trạng thái chưa đăng nhập
      throw error;
    }
    return api(config); // gửi lại; request interceptor sẽ gắn token mới
  },
);
