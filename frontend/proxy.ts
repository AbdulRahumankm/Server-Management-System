import { NextRequest, NextResponse } from 'next/server';

const PROTECTED_PATHS = [
  '/dashboard',
  '/servers',
  '/keys',
  '/inventory',
  '/users',
  '/roles',
  '/audit-logs',
];

export function proxy(request: NextRequest) {
  const isProtected = PROTECTED_PATHS.some((path) => request.nextUrl.pathname.startsWith(path));
  if (!isProtected) {
    return NextResponse.next();
  }

  if (!request.cookies.has('access_token')) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/servers/:path*',
    '/keys/:path*',
    '/inventory/:path*',
    '/users/:path*',
    '/roles/:path*',
    '/audit-logs/:path*',
  ],
};
