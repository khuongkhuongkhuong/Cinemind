import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from '@/context/AuthContext';
import { ToastProvider } from '@/components/ui/Toast';
import { router } from '@/routes/router';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Lỗi 4xx (sai dữ liệu, không có quyền, không tìm thấy) thử lại cũng vô ích; chỉ thử lại khi mất mạng / lỗi máy chủ.
      retry: (failureCount, error) => !(error?.response?.status >= 400 && error.response.status < 500) && failureCount < 2,
    },
  },
});

async function enableMocking() {
  if (import.meta.env.VITE_ENABLE_MOCK !== 'true') return;
  const { worker } = await import('@/mocks/browser');
  await worker.start({ onUnhandledRequest: 'bypass' });
}

enableMocking().then(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
});
