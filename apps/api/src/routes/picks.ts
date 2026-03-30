import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiRuntimeDependencies } from '../server.js';
import { handleSettlePick } from '../handlers/index.js';
import { requeuePickController } from '../controllers/requeue-controller.js';
import { readJsonBody } from '../server.js';
import { writeJson } from '../http-utils.js';

export async function handleSettlePickRoute(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
  pickId: string,
): Promise<void> {
  const body = await readJsonBody(request, runtime.bodyLimitBytes);
  const apiResponse = await handleSettlePick(
    {
      params: { pickId },
      body,
    },
    runtime.repositories,
  );
  writeJson(response, apiResponse.status, apiResponse.body);
}

export async function handleRequeuePick(
  _request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
  pickId: string,
): Promise<void> {
  const apiResponse = await requeuePickController(pickId, runtime.repositories);
  writeJson(response, apiResponse.status, apiResponse.body);
}
