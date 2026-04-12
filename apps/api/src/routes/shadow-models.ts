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

/**
 * Phase 7D UTV2-506: governed shadow comparison read surface.
 * Returns recent experiment ledger entries for shadow_comparison runs.
 * Read-only — does not alter routing or promotion behavior.
 */
export async function handleShadowComparison(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
): Promise<void> {
  const experimentLedger = runtime.repositories.experimentLedger;
  if (!experimentLedger) {
    writeJson(response, 200, { ok: true, data: [], note: 'experiment ledger not available' });
    return;
  }

  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const modelId = url.searchParams.get('modelId');

  try {
    if (modelId) {
      const entries = await experimentLedger.listByModelId(modelId);
      const shadowEntries = entries.filter(e => e.run_type === 'shadow_comparison');
      writeJson(response, 200, {
        ok: true,
        data: shadowEntries,
        count: shadowEntries.length,
      });
    } else {
      // No modelId — return empty with guidance
      writeJson(response, 200, {
        ok: true,
        data: [],
        note: 'Provide ?modelId=<uuid> to query shadow comparison entries for a specific model.',
      });
    }
  } catch (err) {
    writeJson(response, 500, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

