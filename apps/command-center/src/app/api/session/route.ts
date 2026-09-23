import { NextResponse } from 'next/server';
import { authenticateHeaderBag } from '@/lib/request-auth';
import {
  isSameOriginSessionRequest, issueOperatorSession, SESSION_COOKIE, sessionCookieOptions,
} from '@/lib/session-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await authenticateHeaderBag(request.headers);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.status === 503 ? 'Command Center is unavailable.' : 'Authentication required.' }, { status: auth.status, headers: { 'Cache-Control': 'no-store' } });
  if (!isSameOriginSessionRequest(request)) return NextResponse.json({ error: 'Same-origin sign-in required.' }, { status: 403 });
  if (auth.method !== 'basic' && auth.method !== 'bearer') {
    return NextResponse.json({ error: 'Valid operator credentials required.' }, { status: 401 });
  }
  const credential = await issueOperatorSession(request.headers);
  const response = NextResponse.json({ ok: true, actor: auth.actor }, { headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(SESSION_COOKIE, credential, sessionCookieOptions(request.url, request.headers));
  return response;
}

export async function DELETE(request: Request) {
  if (!isSameOriginSessionRequest(request)) return NextResponse.json({ error: 'Same-origin sign-out required.' }, { status: 403 });
  const auth = await authenticateHeaderBag(request.headers);
  if (!auth.ok) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(request.url, request.headers), maxAge: 0 });
  return response;
}
