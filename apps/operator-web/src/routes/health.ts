import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OperatorRouteDependencies } from '../server.js';
import { writeJson } from '../http-utils.js';

export async function handleHealthRequest(
  _request: IncomingMessage,
  response: ServerResponse,
  deps: OperatorRouteDependencies,
): Promise<void> {
  const snapshot = await deps.provider.getSnapshot();
  writeJson(response, 200, {
    ok: true,
    service: 'operator-web',
    persistenceMode: snapshot.persistenceMode,
    observedAt: snapshot.observedAt,
    health: snapshot.health,
  });
}
