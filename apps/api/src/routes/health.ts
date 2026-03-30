import type { ServerResponse } from 'node:http';
import type { ApiRuntimeDependencies, ApiHealthResponse } from '../server.js';
import { writeJson } from '../http-utils.js';

export function handleHealth(response: ServerResponse, runtime: ApiRuntimeDependencies): void {
  writeJson(response, 200, {
    ok: true,
    service: 'api',
    persistenceMode: runtime.persistenceMode,
    runtimeMode: runtime.runtimeMode,
  } satisfies ApiHealthResponse);
}
