/**
 * GET /api/health/config
 *
 * Exposes the active runtime configuration so operators can verify the system
 * is running with the intended policy, scoring profile, and target set.
 *
 * Also surfaces feature-availability signals so operators know when derived
 * intelligence (CLV, sharp consensus, edge) is degraded due to missing upstream
 * data — rather than receiving silent zeros or nulls.
 *
 * Auth: operator role required.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolveScoringProfile, type PromotionBoardCaps } from '@unit-talk/contracts';
import { authenticateRequest } from '../auth.js';
import { writeJson } from '../http-utils.js';
import type { ApiRuntimeDependencies } from '../server.js';

export interface FeatureAvailabilitySignal {
  available: boolean;
  reason: string;
}

export interface ApiConfigResponse {
  service: 'api';
  scoringProfile: string;
  persistenceMode: string;
  runtimeMode: string;
  distributionTargetsConfigured: string[];
  featureAvailability: {
    closingLines: FeatureAvailabilitySignal;
    clv: FeatureAvailabilitySignal;
    sharpConsensus: FeatureAvailabilitySignal;
    edge: FeatureAvailabilitySignal;
  };
  boardCaps: {
    bestBets: PromotionBoardCaps | null;
    traderInsights: PromotionBoardCaps | null;
  };
}

export async function handleHealthConfig(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
): Promise<void> {
  // Operator auth required — fail closed
  const auth = await authenticateRequest(request, runtime.authConfig);
  if (!auth || auth.role !== 'operator') {
    writeJson(response, 401, {
      ok: false,
      error: { code: 'UNAUTHORIZED', message: 'operator role required' },
    });
    return;
  }

  const scoringProfileName = process.env['UNIT_TALK_SCORING_PROFILE'] ?? 'default';
  const profile = resolveScoringProfile(scoringProfileName);

  const distributionTargetsConfigured = (
    process.env['UNIT_TALK_DISTRIBUTION_TARGETS'] ?? ''
  )
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  const featureAvailability = await computeFeatureAvailability(runtime);

  const body: ApiConfigResponse = {
    service: 'api',
    scoringProfile: profile.name,
    persistenceMode: runtime.persistenceMode,
    runtimeMode: runtime.runtimeMode,
    distributionTargetsConfigured,
    featureAvailability,
    boardCaps: {
      bestBets: profile.policies['best-bets']?.boardCaps ?? null,
      traderInsights: profile.policies['trader-insights']?.boardCaps ?? null,
    },
  };

  writeJson(response, 200, body);
}

async function computeFeatureAvailability(
  runtime: ApiRuntimeDependencies,
): Promise<ApiConfigResponse['featureAvailability']> {
  if (runtime.persistenceMode !== 'database') {
    const inmem: FeatureAvailabilitySignal = {
      available: false,
      reason: 'in-memory persistence mode — no live data',
    };
    return { closingLines: inmem, clv: inmem, sharpConsensus: inmem, edge: inmem };
  }

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [closingLinesCount, sharpCount] = await Promise.all([
    countClosingLines(runtime, since),
    countSharpReferenceOffers(runtime, since),
  ]);

  const closingLines: FeatureAvailabilitySignal =
    closingLinesCount > 0
      ? { available: true, reason: `${closingLinesCount} closing-line offer(s) present` }
      : { available: false, reason: 'zero is_closing rows in provider_offers' };

  const clv: FeatureAvailabilitySignal =
    closingLinesCount > 0
      ? { available: true, reason: 'closing lines present — CLV computable' }
      : { available: false, reason: 'CLV requires closing lines — none found' };

  const sharpConsensus: FeatureAvailabilitySignal =
    sharpCount > 0
      ? {
          available: true,
          reason: `${sharpCount} sharp-reference offer(s) available (Pinnacle/Circa)`,
        }
      : { available: false, reason: 'no Pinnacle or Circa offers found — sharp consensus unavailable' };

  const edge: FeatureAvailabilitySignal =
    closingLinesCount > 0
      ? { available: true, reason: 'closing lines present — edge computable' }
      : { available: false, reason: 'edge requires closing lines — none found' };

  return { closingLines, clv, sharpConsensus, edge };
}

async function countClosingLines(
  runtime: ApiRuntimeDependencies,
  since: string,
): Promise<number> {
  try {
    const rows = await runtime.repositories.providerOffers.listRecentOffers(since);
    return rows.filter((r) => r.is_closing === true).length;
  } catch {
    return 0;
  }
}

/** Sharp reference = Pinnacle or Circa offers. Keyed by bookmaker_key on each row. */
async function countSharpReferenceOffers(
  runtime: ApiRuntimeDependencies,
  since: string,
): Promise<number> {
  try {
    const rows = await runtime.repositories.providerOffers.listRecentOffers(since);
    return rows.filter(
      (r) => r.bookmaker_key === 'pinnacle' || r.bookmaker_key === 'circa',
    ).length;
  } catch {
    return 0;
  }
}
