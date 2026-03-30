import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OperatorRouteDependencies, OperatorStatsQuery, StatsWindowDays } from '../server.js';
import { writeJson } from '../http-utils.js';

function normalizeOptionalQueryValue(value: string | null): string | undefined {
  if (value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isAllowedStatsWindow(value: number): value is StatsWindowDays {
  return value === 7 || value === 14 || value === 30 || value === 90;
}

export function parseStatsQuery(url: URL): OperatorStatsQuery | { error: string } {
  const requestedWindow = url.searchParams.get('last');
  const parsedWindow = requestedWindow === null ? 30 : Number.parseInt(requestedWindow, 10);
  if (!isAllowedStatsWindow(parsedWindow)) {
    return { error: 'Query parameter "last" must be one of 7, 14, 30, 90.' };
  }

  const capper = normalizeOptionalQueryValue(url.searchParams.get('capper'));
  const sport = normalizeOptionalQueryValue(url.searchParams.get('sport'));

  return {
    ...(capper ? { capper } : {}),
    ...(sport ? { sport } : {}),
    window: parsedWindow,
  };
}

export async function handleStatsRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: OperatorRouteDependencies,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const statsQuery = parseStatsQuery(url);
  if ('error' in statsQuery) {
    writeJson(response, 400, {
      ok: false,
      error: {
        code: 'INVALID_QUERY',
        message: statsQuery.error,
      },
    });
    return;
  }

  const stats = await deps.statsProvider.getStats(statsQuery);
  writeJson(response, 200, { ok: true, data: stats });
}
