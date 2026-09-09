import { NextResponse } from 'next/server';
import { getPrivilegedGlobalHealth, type GlobalHealth } from '@/lib/global-health';
import { authenticateHeaderBag } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';

const CACHE_MS = 30_000;

/**
 * Public callers receive liveness only. Authenticated callers receive the
 * lifecycle-derived operator health used by the shell.
 */
export function createHealthHandler(
  readHealth: () => Promise<GlobalHealth> = getPrivilegedGlobalHealth,
) {
  let cache: { at: number; body: GlobalHealth } | null = null;

  return async function health(request: Request) {
    const auth = authenticateHeaderBag(request.headers);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: true, service: 'command-center' },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    if (cache && Date.now() - cache.at < CACHE_MS) {
      return NextResponse.json(cache.body, { headers: { 'Cache-Control': 'no-store' } });
    }

    try {
      const body = await readHealth();
      cache = { at: Date.now(), body };
      return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      console.error('command_center.health_read_failed', error);
      return NextResponse.json(
        { ok: false, error: 'Operator health is unavailable.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
  };
}

export const GET = createHealthHandler();
