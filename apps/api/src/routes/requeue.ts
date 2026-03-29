import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiRouteDependencies } from '../server.js';
import { writeJson } from '../http-utils.js';
import { requeuePickController } from '../controllers/requeue-controller.js';

export async function handleRequeueRequest(
  _request: IncomingMessage,
  response: ServerResponse,
  deps: ApiRouteDependencies,
  pickId: string,
): Promise<void> {
  const apiResponse = await requeuePickController(pickId, deps.repositories);
  writeJson(response, apiResponse.status, apiResponse.body);
}
