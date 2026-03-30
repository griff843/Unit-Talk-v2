import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OperatorRouteDependencies } from '../server.js';
import { writeJson } from '../http-utils.js';

export async function handleRecapRequest(
  _request: IncomingMessage,
  response: ServerResponse,
  deps: OperatorRouteDependencies,
): Promise<void> {
  const snapshot = await deps.provider.getSnapshot();
  writeJson(response, 200, { ok: true, data: snapshot.recap });
}
