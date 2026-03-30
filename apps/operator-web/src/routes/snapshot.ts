import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OperatorRouteDependencies, OutboxFilter } from '../server.js';
import { writeJson } from '../http-utils.js';

export async function handleSnapshotRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: OperatorRouteDependencies,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const outboxStatus = url.searchParams.get('outboxStatus');
  const target = url.searchParams.get('target');
  const since = url.searchParams.get('since');
  const lifecycleState = url.searchParams.get('lifecycleState');
  const rawLimit = url.searchParams.get('limit');
  const parsedLimit = rawLimit !== null ? parseInt(rawLimit, 10) : NaN;
  const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(100, parsedLimit)) : 25;
  const filter: OutboxFilter | undefined =
    outboxStatus || target || since || lifecycleState || rawLimit
      ? {
          ...(outboxStatus !== null ? { status: outboxStatus } : {}),
          ...(target !== null ? { target } : {}),
          ...(since !== null ? { since } : {}),
          ...(lifecycleState !== null ? { lifecycleState } : {}),
          limit,
        }
      : undefined;
  const snapshot = await deps.provider.getSnapshot(filter);
  writeJson(response, 200, { ok: true, data: snapshot });
}
