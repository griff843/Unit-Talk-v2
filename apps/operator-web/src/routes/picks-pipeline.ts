import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OperatorRouteDependencies, OutboxFilter } from '../server.js';
import { writeJson } from '../http-utils.js';

export async function handlePicksPipelineRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: OperatorRouteDependencies,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const since = url.searchParams.get('since');
  const lifecycleState = url.searchParams.get('lifecycleState');
  const filter: OutboxFilter | undefined =
    since || lifecycleState
      ? {
          ...(since !== null ? { since } : {}),
          ...(lifecycleState !== null ? { lifecycleState } : {}),
        }
      : undefined;
  const snapshot = await deps.provider.getSnapshot(filter);
  writeJson(response, 200, {
    ok: true,
    data: {
      observedAt: snapshot.observedAt,
      counts: snapshot.picksPipeline.counts,
      recentPicks: snapshot.picksPipeline.recentPicks,
    },
  });
}
