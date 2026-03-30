import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OperatorRouteDependencies, OperatorCapperRecapQuery } from '../server.js';
import { writeJson } from '../http-utils.js';

function normalizeOptionalQueryValue(value: string | null): string | undefined {
  if (value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseCapperRecapQuery(
  url: URL,
): OperatorCapperRecapQuery | { error: string } {
  const submittedBy = normalizeOptionalQueryValue(url.searchParams.get('submittedBy'));
  if (!submittedBy) {
    return { error: 'Query parameter "submittedBy" is required.' };
  }

  const requestedLimit = Number.parseInt(url.searchParams.get('limit') ?? '10', 10);

  return {
    submittedBy,
    limit: Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 20) : 10,
  };
}

export async function handleCapperRecapRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: OperatorRouteDependencies,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const capperRecapQuery = parseCapperRecapQuery(url);
  if ('error' in capperRecapQuery) {
    writeJson(response, 400, {
      ok: false,
      error: {
        code: 'INVALID_QUERY',
        message: capperRecapQuery.error,
      },
    });
    return;
  }

  const recap = await deps.capperRecapProvider.getCapperRecap(capperRecapQuery);
  writeJson(response, 200, { ok: true, data: recap });
}
