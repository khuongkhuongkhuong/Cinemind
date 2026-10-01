import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    // Chuyển /api sang backend: trình duyệt chỉ thấy MỘT origin (localhost:5173), nên cookie refresh token
    // (httpOnly, SameSite=Lax) hoạt động như khi triển khai thật, không vướng CORS.
    proxy: { '/api': { target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:4000' } },
  },
  test: {
    environment: 'jsdom', globals: true, setupFiles: './src/test/setup.js', css: false,
    // Axios chạy trong Node khi test nên cần URL tuyệt đối; trùng gốc với jsdom (http://localhost:3000) để MSW khớp đường dẫn tương đối.
    env: { VITE_API_URL: 'http://localhost:3000/api/v1' },
  },
});
