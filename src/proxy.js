// =====================================================================
// proxy.js: Server-side route guard (Next.js 16 "proxy", formerly middleware)
// Redirects before any page renders, so protected pages never flash.
// =====================================================================

import { NextResponse } from 'next/server';
import { AUTH_COOKIE, verifyToken } from './lib/jwt';

const homeFor = (role) => (role === 'student' ? '/student/dashboard' : '/faculty/dashboard');

export async function proxy(request) {
  const { pathname } = request.nextUrl;
  const payload = await verifyToken(request.cookies.get(AUTH_COOKIE)?.value);
  const role = payload?.role;
  const redirect = (to) => NextResponse.redirect(new URL(to, request.url));

  if (pathname === '/') {
    return redirect(role ? homeFor(role) : '/login');
  }

  if (pathname === '/login' || pathname === '/register') {
    return role ? redirect(homeFor(role)) : NextResponse.next();
  }

  if (!role) {
    const login = new URL('/login', request.url);
    login.searchParams.set('next', pathname);
    return NextResponse.redirect(login);
  }

  if (pathname.startsWith('/student') && role !== 'student') return redirect(homeFor(role));
  if (pathname.startsWith('/faculty') && role === 'student') return redirect(homeFor(role));

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/login', '/register', '/student/:path*', '/faculty/:path*']
};
