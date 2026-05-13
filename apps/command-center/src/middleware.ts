import { NextResponse, type NextRequest } from 'next/server';
import {
  authenticateCommandCenterRequest,
  logCommandCenterAuthFailure,
  logCommandCenterPrivilegedAction,
} from './lib/server-api';

const PUBLIC_PATH_PREFIXES = [
  '/_next/static',
  '/_next/image',
  '/api/health',
  '/favicon.ico',
  '/icon.svg',
];

export function middleware(request: NextRequest) {
  const route = request.nextUrl.pathname;
  if (isPublicPath(route)) {
    return NextResponse.next();
  }

  const requestId =
    request.headers.get('x-request-id') ??
    request.headers.get('x-correlation-id') ??
    crypto.randomUUID();
  const auth = authenticateCommandCenterRequest({ headers: request.headers });

  if (!auth.ok) {
    logCommandCenterAuthFailure({
      code: auth.code,
      route,
      method: request.method,
      requestId,
    });

    return new NextResponse(
      JSON.stringify({
        ok: false,
        error: { code: auth.code, message: auth.message },
      }),
      {
        status: auth.status,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          ...(auth.challenge ? { 'WWW-Authenticate': auth.challenge } : {}),
          'X-Request-Id': requestId,
        },
      },
    );
  }

  logCommandCenterPrivilegedAction({
    route,
    method: request.method,
    actor: auth.auth.actor,
    role: auth.auth.role,
    requestId,
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-command-center-actor', auth.auth.actor);
  requestHeaders.set('x-command-center-role', auth.auth.role);
  requestHeaders.set('x-request-id', requestId);

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: ['/((?!.*\\..*).*)', '/icon.svg'],
};

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
