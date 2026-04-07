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

import type { ServerResponse } from 'node:http';
import { resolveScoringProfile, type PromotionBoardCaps } from '@unit-talk/contracts';
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
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
): Promise<void> {
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

  const [closingLinesCount, sharpCount] = await Promise.all([
    countProviderOffers(runtime, true),
    countProviderOffers(runtime, false, 'pinnacle'),
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
      ? { available: true, reason: `${sharpCount} Pinnacle offer(s) available as sharp reference` }
      : { available: false, reason: 'no Pinnacle offers found — sharp consensus unavailable' };

  const edge: FeatureAvailabilitySignal =
    closingLinesCount > 0
      ? { available: true, reason: 'closing lines present — edge computable' }
      : { available: false, reason: 'edge requires closing lines — none found' };

  return { closingLines, clv, sharpConsensus, edge };
}

async function countProviderOffers(
  runtime: ApiRuntimeDependencies,
  isClosing: boolean,
  bookmakerKey?: string,
): Promise<number> {
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    if (bookmakerKey) {
      const rows = await runtime.repositories.providerOffers.listByProvider(bookmakerKey);
      return rows.length;
    }

    const rows = await runtime.repositories.providerOffers.listRecentOffers(since);
    if (isClosing) {
      return rows.filter((r) => r.is_closing === true).length;
    }
    return rows.length;
  } catch {
    return 0;
  }
}
