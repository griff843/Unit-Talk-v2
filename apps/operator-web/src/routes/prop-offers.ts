import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OperatorRouteDependencies } from '../server.js';
import { writeJson } from '../http-utils.js';

export async function handlePropOffersRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: OperatorRouteDependencies,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');

  const sport = url.searchParams.get('sport') || undefined;
  const market = url.searchParams.get('market') || undefined;
  const bookmaker = url.searchParams.get('bookmaker') || undefined;
  const participant = url.searchParams.get('participant') || undefined;
  const since = url.searchParams.get('since') || undefined;
  const until = url.searchParams.get('until') || undefined;

  const rawLimit = Number.parseInt(url.searchParams.get('limit') ?? '50', 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;

  const rawOffset = Number.parseInt(url.searchParams.get('offset') ?? '0', 10);
  const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;

  const result = await deps.provider.getPropOffers?.({
    ...(sport !== undefined ? { sport } : {}),
    ...(market !== undefined ? { market } : {}),
    ...(bookmaker !== undefined ? { bookmaker } : {}),
    ...(participant !== undefined ? { participant } : {}),
    ...(since !== undefined ? { since } : {}),
    ...(until !== undefined ? { until } : {}),
    limit,
    offset,
  });

  writeJson(
    response,
    200,
    result ?? { offers: [], total: 0, hasMore: false, observedAt: new Date().toISOString() },
  );
}
