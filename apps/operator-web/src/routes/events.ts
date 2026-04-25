import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OperatorRouteDependencies } from '../server.js';
import { writeJson } from '../http-utils.js';

function normalizeOptionalQueryValue(value: string | null): string | undefined {
  if (value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function handleEventsRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: OperatorRouteDependencies,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const sport = normalizeOptionalQueryValue(url.searchParams.get('sport'));
  const date = normalizeOptionalQueryValue(url.searchParams.get('date'));
  const q = normalizeOptionalQueryValue(url.searchParams.get('q'));
  const eventId = normalizeOptionalQueryValue(url.searchParams.get('eventId'));
  const requestedLimit = Number.parseInt(url.searchParams.get('limit') ?? '24', 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 24;

  const result = await deps.provider.getEvents?.({
    ...(sport ? { sport } : {}),
    ...(date ? { date } : {}),
    ...(q ? { q } : {}),
    ...(eventId ? { eventId } : {}),
    limit,
  });

  writeJson(
    response,
    200,
    result ?? { events: [], selectedEvent: null, total: 0, observedAt: new Date().toISOString() },
  );
}
