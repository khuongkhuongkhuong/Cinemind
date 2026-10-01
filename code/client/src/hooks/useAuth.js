import { useContext } from 'react';
import { AuthContext } from '@/context/AuthContext';

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth phải được dùng bên trong <AuthProvider>');
  return ctx;
}

/** Vai trò STAFF được hiểu là STAFF hoặc ADMIN (hợp đồng API mục 1.4). */
export const isStaff = (user) => user?.role === 'STAFF' || user?.role === 'ADMIN';
export const isAdmin = (user) => user?.role === 'ADMIN';
