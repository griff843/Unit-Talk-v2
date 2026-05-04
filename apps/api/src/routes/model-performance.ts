/**
 * GET /api/model-performance
 *
 * Read-only analytics endpoint for model performance calibration.
 * Returns tier groupings, sport/market breakdowns, champion model coverage,
 * and stale-data markers from posted/settled pick outcomes.
 *
 * Response is CALIBRATION EVIDENCE ONLY — not a scoring input.
 *
 * Query params:
 *   sport  (optional) — filter by sport key (e.g. NBA, NHL)
 *   tier   (optional) — filter by model_tier metadata value (e.g. T1, T2)
 *   from   (optional) — ISO date string lower bound on pick.created_at
 *   to     (optional) — ISO date string upper bound on pick.created_at
 *   limit  (optional) — max settled picks to load (default 2000, max 5000)
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiRuntimeDependencies } from '../server.js';
import { writeJson } from '../http-utils.js';
import { getModelPerformanceReport, type ModelPerformanceFilters } from '../model-performance-service.js';

export async function handleModelPerformance(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');

  const sport = url.searchParams.get('sport') ?? undefined;
  const tier = url.searchParams.get('tier') ?? undefined;
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');

  const filters: ModelPerformanceFilters = {};

  if (sport) filters.sport = sport;
  if (tier) filters.tier = tier;

  if (fromParam || toParam) {
    const fromDate = fromParam ? new Date(fromParam) : undefined;
    const toDate = toParam ? new Date(toParam) : undefined;

    if (fromDate && Number.isNaN(fromDate.getTime())) {
      return writeJson(response, 400, {
        ok: false,
        error: { code: 'INVALID_FROM_DATE', message: 'Query param "from" must be a valid ISO date string.' },
      });
    }

    if (toDate && Number.isNaN(toDate.getTime())) {
      return writeJson(response, 400, {
        ok: false,
        error: { code: 'INVALID_TO_DATE', message: 'Query param "to" must be a valid ISO date string.' },
      });
    }

    if (fromDate && toDate) {
      filters.dateRange = { from: fromDate, to: toDate };
    } else if (fromDate) {
      filters.dateRange = { from: fromDate, to: new Date() };
    } else if (toDate) {
      filters.dateRange = { from: new Date(0), to: toDate };
    }
  }

  try {
    const report = await getModelPerformanceReport(
      {
        picks: runtime.repositories.picks,
        settlements: runtime.repositories.settlements,
      },
      filters,
    );

    writeJson(response, 200, { ok: true, report });
  } catch (err) {
    runtime.logger.error('model-performance report failed', err as Error);
    writeJson(response, 500, {
      ok: false,
      error: {
        code: 'MODEL_PERFORMANCE_ERROR',
        message: err instanceof Error ? err.message : String(err),
      },
    });
  }
}
