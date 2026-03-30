import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiRuntimeDependencies } from '../server.js';
import { runGradingPass } from '../grading-service.js';
import { writeJson } from '../http-utils.js';

export async function handleGradingRun(
  _request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
): Promise<void> {
  const result = await runGradingPass(runtime.repositories);
  writeJson(response, 200, { ok: true, result });
}
