import { NextResponse } from 'next/server';
import { getDashboardData } from '@/lib/data';
import type { LifecycleSignal } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Global health for the shell pill — derived from the SAME lifecycle signals
 * that drive the Executive Overview "API Health" KPI, so the two can never
 * disagree. Cached in-memory for 30s; fail-closed to 'unknown' on error.
 */

type GlobalHealth = 'healthy' | 'degraded' | 'down' | 'unknown';

interface HealthBody {
  status: GlobalHealth;
  degradedSignals: string[];
  observedAt: string;
}

let cache: { at: number; body: HealthBody } | null = null;
const CACHE_MS = 30_000;

function scoreSignal(signal: LifecycleSignal): number {
  if (signal.status === 'BROKEN') return 0;
  if (signal.status === 'DEGRADED') return 1;
  return 2;
}

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json(cache.body, { headers: { 'Cache-Control': 'no-store' } });
  }

  let body: HealthBody;
  try {
    const data = await getDashboardData();
    const min = data.signals.length === 0 ? 2 : Math.min(...data.signals.map(scoreSignal));
    body = {
      status: min === 0 ? 'down' : min === 1 ? 'degraded' : 'healthy',
      degradedSignals: data.signals
        .filter((signal) => signal.status !== 'WORKING')
        .map((signal) => signal.signal),
      observedAt: data.observedAt,
    };
  } catch {
    body = { status: 'unknown', degradedSignals: [], observedAt: new Date().toISOString() };
  }

  cache = { at: Date.now(), body };
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
