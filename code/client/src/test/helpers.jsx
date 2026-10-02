import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { HttpResponse } from 'msw';
import { ToastProvider } from '@/components/ui/Toast';

export const ok = (data, meta) => HttpResponse.json({ success: true, data, ...(meta && { meta }) });
export const err = (status, code, message, details) =>
  HttpResponse.json({ success: false, error: { code, message, ...(details && { details }) } }, { status });

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}{l.search}</div>;
}

/**
 * Vẽ một trang trong môi trường giống thật: bộ nhớ đệm truy vấn, thông báo (Toast), router.
 * `routes` là danh sách { path, element } để kiểm tra điều hướng giữa các trang.
 */
export function renderPage(routes, path, { queryClient } = {}) {
  const client = queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>{routes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}</Routes>
          <Where />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...result, client };
}
