import type { IncomingMessage, ServerResponse } from 'node:http';
import type { MemberPerformanceOptions } from '@unit-talk/domain';
import type { AuthContext } from '../auth.js';
import type { ApiRuntimeDependencies } from '../server.js';
import { writeJson } from '../http-utils.js';
import { getMemberPerformance } from '../member-performance-service.js';

export function canReadMemberPerformance(auth: AuthContext): boolean {
  if (auth.identity === 'anonymous:auth-bypass') return false;
  return (
    auth.role === 'operator' ||
    (auth.role === 'submitter' &&
      auth.identity.startsWith('submitter:discord-bot:'))
  );
}

function integer(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new Error('Invalid integer');
  return Number(value);
}

export async function handleMemberPerformance(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  let options: MemberPerformanceOptions;
  try {
    const window = integer(url.searchParams.get('last'), 30);
    if (window !== 7 && window !== 14 && window !== 30 && window !== 90)
      throw new Error('Invalid window');
    const capper = url.searchParams.get('capper')?.trim() || null;
    const sport = url.searchParams.get('sport')?.trim() || null;
    if ((capper?.length ?? 0) > 100 || (sport?.length ?? 0) > 20)
      throw new Error('Filter too long');
    options = {
      window,
      sport,
      capper,
      observedAt: new Date(runtime.now()).toISOString(),
      limit: Math.max(
        1,
        Math.min(25, integer(url.searchParams.get('limit'), 10)),
      ),
      minPicks: integer(url.searchParams.get('minPicks'), 3),
    };
    if (options.minPicks < 1 || options.minPicks > 50_000)
      throw new Error('Minimum exceeds read budget');
  } catch {
    return writeJson(response, 400, {
      ok: false,
      error: {
        code: 'INVALID_PERFORMANCE_QUERY',
        message: 'Choose a valid window and filters.',
      },
    });
  }
  try {
    const report = await getMemberPerformance(runtime.repositories, options);
    return writeJson(response, 200, {
      ok: true,
      data:
        url.pathname === '/api/operator/stats'
          ? report.stats
          : report.leaderboard,
    });
  } catch (error) {
    runtime.logger.error(
      'Public performance read failed',
      error instanceof Error ? error : new Error('Performance unavailable'),
    );
    return writeJson(response, 503, {
      ok: false,
      error: {
        code: 'PUBLIC_PERFORMANCE_UNAVAILABLE',
        message:
          'Performance is temporarily unavailable. Please try again shortly.',
      },
    });
  }
}
