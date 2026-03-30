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

export async function handleParticipantsRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: OperatorRouteDependencies,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const type = url.searchParams.get('type');
  const sport = normalizeOptionalQueryValue(url.searchParams.get('sport'));
  const q = normalizeOptionalQueryValue(url.searchParams.get('q'));
  const requestedLimit = Number.parseInt(url.searchParams.get('limit') ?? '20', 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 20;
  const participants = await deps.provider.getParticipants?.({
    ...(type === 'player' || type === 'team' ? { type } : {}),
    ...(sport ? { sport } : {}),
    ...(q ? { q } : {}),
    limit,
  });

  writeJson(
    response,
    200,
    participants ?? { participants: [], total: 0, observedAt: new Date().toISOString() },
  );
}
