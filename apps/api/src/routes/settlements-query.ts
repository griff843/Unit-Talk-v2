import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiRuntimeDependencies } from '../server.js';
import { writeJson, readOptionalInteger } from '../http-utils.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * GET /api/settlements/recent?limit=50
 *
 * Read-only query endpoint for recent settlement records.
 * Used by discord-bot for /results command.
 */
export async function handleSettlementsRecent(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const rawLimit = readOptionalInteger(url.searchParams.get('limit'));
  const limit = Math.min(rawLimit ?? DEFAULT_LIMIT, MAX_LIMIT);

  const settlements = await runtime.repositories.settlements.listRecent(limit);

  writeJson(response, 200, { ok: true, settlements, count: settlements.length });
}
