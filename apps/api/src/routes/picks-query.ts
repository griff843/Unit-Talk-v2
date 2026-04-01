import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiRuntimeDependencies } from '../server.js';
import { writeJson, readOptionalInteger } from '../http-utils.js';
import type { CanonicalPick } from '@unit-talk/contracts';

const VALID_STATUSES: Set<CanonicalPick['lifecycleState']> = new Set([
  'draft', 'validated', 'queued', 'posted', 'settled', 'voided',
]);

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * GET /api/picks?status=validated,queued,posted&limit=50
 *
 * Read-only query endpoint for pick lists filtered by lifecycle status.
 * Used by discord-bot for /live, /today, /my-picks commands.
 */
export async function handlePicksQuery(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const statusParam = url.searchParams.get('status');

  if (!statusParam) {
    return writeJson(response, 400, {
      ok: false,
      error: { code: 'MISSING_STATUS', message: 'Query parameter "status" is required (comma-separated lifecycle states)' },
    });
  }

  const requestedStatuses = statusParam.split(',').map((s) => s.trim());
  const invalid = requestedStatuses.filter((s) => !VALID_STATUSES.has(s as CanonicalPick['lifecycleState']));
  if (invalid.length > 0) {
    return writeJson(response, 400, {
      ok: false,
      error: { code: 'INVALID_STATUS', message: `Invalid status values: ${invalid.join(', ')}. Valid: ${[...VALID_STATUSES].join(', ')}` },
    });
  }

  const rawLimit = readOptionalInteger(url.searchParams.get('limit'));
  const limit = Math.min(rawLimit ?? DEFAULT_LIMIT, MAX_LIMIT);

  const picks = await runtime.repositories.picks.listByLifecycleStates(
    requestedStatuses as CanonicalPick['lifecycleState'][],
    limit,
  );

  writeJson(response, 200, { ok: true, picks, count: picks.length });
}
