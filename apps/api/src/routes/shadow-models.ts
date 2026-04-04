import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiRuntimeDependencies } from '../server.js';
import { readOptionalInteger, writeJson } from '../http-utils.js';
import { getShadowModelSummaries } from '../shadow-model-summary-service.js';

export async function handleShadowModelSummaries(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const limit = readOptionalInteger(url.searchParams.get('limit')) ?? 200;
  const body = await getShadowModelSummaries(
    {
      picks: runtime.repositories.picks,
      settlements: runtime.repositories.settlements,
    },
    limit,
  );
  writeJson(response, 200, body);
}

