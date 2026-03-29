import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiHealthResponse, ApiRouteDependencies } from '../server.js';
import { writeJson } from '../http-utils.js';

export async function handleHealthRequest(
  _request: IncomingMessage,
  response: ServerResponse,
  deps: ApiRouteDependencies,
): Promise<void> {
  writeJson(response, 200, {
    ok: true,
    service: 'api',
    persistenceMode: deps.persistenceMode,
    runtimeMode: deps.runtimeMode,
  } satisfies ApiHealthResponse);
}
