import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OperatorRouteDependencies, OperatorLeaderboardQuery, StatsWindowDays } from '../server.js';
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

export function parseLeaderboardQuery(
  url: URL,
): OperatorLeaderboardQuery | { error: string } {
  const requestedWindow = url.searchParams.get('last');
  const parsedWindow = requestedWindow === null ? 30 : Number.parseInt(requestedWindow, 10);
  if (!isAllowedStatsWindow(parsedWindow)) {
    return { error: 'Query parameter "last" must be one of 7, 14, 30, 90.' };
  }

  const sport = normalizeOptionalQueryValue(url.searchParams.get('sport'));
  const requestedLimit = Number.parseInt(url.searchParams.get('limit') ?? '10', 10);
  const requestedMinPicks = Number.parseInt(url.searchParams.get('minPicks') ?? '3', 10);

  return {
    ...(sport ? { sport } : {}),
    window: parsedWindow,
    limit: Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 25) : 10,
    minPicks:
      Number.isFinite(requestedMinPicks) && requestedMinPicks > 0 ? requestedMinPicks : 3,
  };
}

export async function handleLeaderboardRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: OperatorRouteDependencies,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const leaderboardQuery = parseLeaderboardQuery(url);
  if ('error' in leaderboardQuery) {
    writeJson(response, 400, {
      ok: false,
      error: {
        code: 'INVALID_QUERY',
        message: leaderboardQuery.error,
      },
    });
    return;
  }

  const leaderboard = await deps.leaderboardProvider.getLeaderboard(leaderboardQuery);
  writeJson(response, 200, { ok: true, data: leaderboard });
}
