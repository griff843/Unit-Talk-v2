import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiRuntimeDependencies } from '../server.js';
import { writeJson } from '../http-utils.js';
import type { PromotionScoreComponents } from '@unit-talk/contracts';

/**
 * GET /api/operator/promotion-scores?pickId=<id>
 *
 * Phase 7 UTV2-537: Typed read surface for promotion score components.
 * Returns the score components (edge, trust, readiness, uniqueness, boardFit)
 * from the pick's metadata.promotionScores, typed as PromotionScoreComponents.
 *
 * Read-only. Does not modify any data.
 */
export async function handlePromotionScores(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const pickId = url.searchParams.get('pickId');

  if (!pickId) {
    writeJson(response, 400, {
      ok: false,
      error: 'Missing required query parameter: pickId',
    });
    return;
  }

  try {
    const pick = await runtime.repositories.picks.findPickById(pickId);
    if (!pick) {
      writeJson(response, 404, {
        ok: false,
        error: `Pick not found: ${pickId}`,
      });
      return;
    }

    const metadata = pick.metadata as Record<string, unknown> | null;
    const rawScores = metadata?.['promotionScores'];
    let scores: PromotionScoreComponents | null = null;

    if (rawScores && typeof rawScores === 'object' && !Array.isArray(rawScores)) {
      const s = rawScores as Record<string, unknown>;
      if (
        typeof s['edge'] === 'number' &&
        typeof s['trust'] === 'number' &&
        typeof s['readiness'] === 'number' &&
        typeof s['uniqueness'] === 'number' &&
        typeof s['boardFit'] === 'number'
      ) {
        scores = {
          edge: s['edge'],
          trust: s['trust'],
          readiness: s['readiness'],
          uniqueness: s['uniqueness'],
          boardFit: s['boardFit'],
          ...(typeof s['edgeSource'] === 'string' ? { edgeSource: s['edgeSource'] as PromotionScoreComponents['edgeSource'] } : {}),
        };
      }
    }

    writeJson(response, 200, {
      ok: true,
      data: {
        pickId,
        status: pick.status,
        source: pick.source,
        scores,
        note: scores ? undefined : 'No promotion scores found in pick metadata',
      },
    });
  } catch (err) {
    writeJson(response, 500, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
