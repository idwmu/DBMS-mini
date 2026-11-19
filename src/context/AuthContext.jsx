'use client';

// =====================================================================
// AuthContext.jsx: Authentication state (seeded from the server session)
// =====================================================================

import { createContext, useContext, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';

const AuthContext = createContext(null);

export function AuthProvider({ initialUser = null, children }) {
  const [user, setUser] = useState(initialUser);
  const router = useRouter();

  const login = async (email, password) => {
    const data = await api.post('/auth/login', { email, password });
    setUser(data.user);
    return data.user;
  };

  const register = async (userData) => {
    const data = await api.post('/auth/register', userData);
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setUser(null);
      router.push('/login');
      router.refresh();
    }
  };

  const value = {
    user,
    login,
    register,
    logout,
    isAuthenticated: !!user,
    isStudent: user?.role === 'student',
    isFaculty: user?.role === 'faculty' || user?.role === 'admin'
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
