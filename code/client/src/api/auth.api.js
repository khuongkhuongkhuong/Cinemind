import { api } from './axios';

// Mọi hàm trả về `data` của response chuẩn { success, data } (hợp đồng API mục 1.1).
const unwrap = (promise) => promise.then((res) => res.data.data);

export const register = (body) => unwrap(api.post('/auth/register', body));
export const login = (body) => unwrap(api.post('/auth/login', body));
export const logout = () => api.post('/auth/logout').then(() => undefined);
export const me = () => unwrap(api.get('/auth/me'));
