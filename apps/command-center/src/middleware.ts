import { NextResponse, type NextRequest } from 'next/server';
import {
  resolveCommandCenterAccessConfig,
  logCommandCenterAuthFailure,
  logCommandCenterDevBypass,
  logCommandCenterPrivilegedAction,
} from './lib/server-api';
import { authenticateSessionOrHeader } from './lib/session-auth';
import { signInDocument } from './lib/sign-in-response';

const PUBLIC_PATH_PREFIXES = [
  '/_next/static',
  '/_next/image',
  '/api/health',
  '/favicon.ico',
  '/icon.svg',
];

export async function middleware(request: NextRequest) {
  const route = request.nextUrl.pathname;
  if (isPublicPath(route)) {
    return NextResponse.next();
  }

  const requestId =
    request.headers.get('x-request-id') ??
    request.headers.get('x-correlation-id') ??
    crypto.randomUUID();
  const auth = await authenticateSessionOrHeader(request.headers);

  if (!auth.ok) {
    logCommandCenterAuthFailure({
      code: auth.code,
      route,
      method: request.method,
      requestId,
    });

    if (request.method === 'GET' && request.headers.get('accept')?.includes('text/html') && !request.headers.has('rsc')) {
      const nonce = crypto.randomUUID().replace(/-/g, '');
      const config = resolveCommandCenterAccessConfig();
      return new NextResponse(signInDocument(nonce, auth.status === 503, Boolean(config.basicUsername && config.basicPassword)), {
        status: auth.status,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Request-Id': requestId,
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
          'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
        },
      });
    }

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
          ...(auth.challenge && route !== '/api/session' ? { 'WWW-Authenticate': auth.challenge } : {}),
          'X-Request-Id': requestId,
        },
      },
    );
  }

  if (auth.auth.method === 'dev_bypass') {
    // An unauthenticated local-development request is not a privileged action by
    // an operator, and recording it as one puts a fabricated actor
    // ("command-center:dev-bypass") into the same audit stream that real
    // operator writes land in. Anyone auditing who changed what would read it as
    // a genuine identity. Log it as what it is -- an unauthenticated request
    // that a development-only bypass let through -- so the two can never be
    // confused after the fact.
    logCommandCenterDevBypass({
      route,
      method: request.method,
      requestId,
    });
  } else {
    logCommandCenterPrivilegedAction({
      route,
      method: request.method,
      actor: auth.auth.actor,
      role: auth.auth.role,
      requestId,
    });
  }

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
  // Exclude ONLY Next's own build output, which carries no application data and
  // is served before any operator context exists. Everything else reaches
  // middleware, and `isPublicPath` above is the single place that decides what
  // is public.
  //
  // The previous matcher was `/((?!.*\..*).*)` — "every path that contains no
  // dot". That is a shape test, not a security boundary: Next never invoked
  // middleware for ANY dotted path, so authentication was skipped entirely
  // rather than evaluated and allowed. It was reachable on a real route.
  // Measured against a running server with auth required:
  //
  //     GET /picks/abc      -> 401   (middleware ran)
  //     GET /picks/abc.def  -> 200   (middleware never ran)
  //
  // `/picks/[id]` is a dynamic segment, so any id containing a dot rendered the
  // operator page — and executed its server components, which hold privileged
  // database access — with no authentication at all. Every future route
  // inherited the same hole for free.
  //
  // Keeping the exclusion list to literal, known prefixes means a new route can
  // never opt itself out of authentication by the shape of its URL.
  matcher: ['/((?!_next/static|_next/image).*)'],
};

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
