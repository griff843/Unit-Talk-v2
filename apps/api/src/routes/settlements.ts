import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiRouteDependencies } from '../server.js';
import { writeJson, readJsonBody } from '../http-utils.js';
import { handleSettlePick } from '../handlers/index.js';

export async function handleSettlementsRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: ApiRouteDependencies,
  pickId: string,
): Promise<void> {
  const body = await readJsonBody(request, deps.bodyLimitBytes);
  const apiResponse = await handleSettlePick(
    { params: { pickId }, body },
    deps.repositories,
  );
  writeJson(response, apiResponse.status, apiResponse.body);
}
