import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiRouteDependencies } from '../server.js';
import { writeJson } from '../http-utils.js';
import { runGradingPass } from '../grading-service.js';

export async function handleGradingRequest(
  _request: IncomingMessage,
  response: ServerResponse,
  deps: ApiRouteDependencies,
): Promise<void> {
  const result = await runGradingPass(deps.repositories);
  writeJson(response, 200, { ok: true, result });
}
