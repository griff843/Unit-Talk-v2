/**
 * Candidate Scoring Service — Phase 3 UTV2-470, Phase 7C UTV2-515
 *
 * Reads pick_candidates rows with status='qualified' and model_score=NULL,
 * computes model_score/model_tier/model_confidence from market_universe data,
 * and writes the scores back.
 *
 * Phase 7C addition: applies bounded market-family trust adjustments from
 * the latest market_family_trust run. When no valid trust row exists for a
 * candidate's market family, scoring is inert (no adjustment).
 *
 * Hard boundaries (never violate):
 * - Never sets pick_id
 * - Never sets shadow_mode=false
 * - Never writes to picks table
 * - Never calls promotion/distribution/settlement services
 */

import { computeModelBlend, initialBandAssignment } from '@unit-talk/domain';
import type {
  IPickCandidateRepository,
  IMarketUniverseRepository,
  IMarketFamilyTrustRepository,
  MarketFamilyTrustRow,
  ModelScoreUpdate,
} from '@unit-talk/db';

export interface ScoringResult {
  scored: number;
  skipped: number;
  errors: number;
  trustAdjusted: number;
  durationMs: number;
}

export interface ScoringOptions {
  batchSize?: number;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

/** Minimum sample size for a trust row to influence scoring. */
const MIN_TRUST_SAMPLE_SIZE = 5;

/** Maximum absolute trust adjustment to model_score (bounded). */
const MAX_TRUST_ADJUSTMENT = 0.05;

export class CandidateScoringService {
  constructor(
    private readonly repos: {
      pickCandidates: IPickCandidateRepository;
      marketUniverse: IMarketUniverseRepository;
      marketFamilyTrust?: IMarketFamilyTrustRepository;
    },
  ) {}

  async run(options: ScoringOptions = {}): Promise<ScoringResult> {
    const startMs = Date.now();
    const batchSize = options.batchSize ?? 200;
    const logger = options.logger;

    // Load all qualified candidates with null model_score
    let candidates;
    try {
      const all = await this.repos.pickCandidates.findByStatus('qualified');
      candidates = all.filter(c => c.model_score === null);
    } catch (err) {
      logger?.error?.(JSON.stringify({
        service: 'candidate-scoring',
        event: 'load_failed',
        error: err instanceof Error ? err.message : String(err),
      }));
      return { scored: 0, skipped: 0, errors: 1, trustAdjusted: 0, durationMs: Date.now() - startMs };
    }

    if (candidates.length === 0) {
      logger?.info?.(JSON.stringify({ service: 'candidate-scoring', event: 'no_unscored_candidates' }));
      return { scored: 0, skipped: 0, errors: 0, trustAdjusted: 0, durationMs: Date.now() - startMs };
    }

    // Bulk-load market universe rows for all candidates
    const universeIds = [...new Set(candidates.map(c => c.universe_id))];
    let universeRows;
    try {
      universeRows = await this.repos.marketUniverse.findByIds(universeIds);
    } catch (err) {
      logger?.error?.(JSON.stringify({
        service: 'candidate-scoring',
        event: 'universe_load_failed',
        error: err instanceof Error ? err.message : String(err),
      }));
      return { scored: 0, skipped: candidates.length, errors: 1, trustAdjusted: 0, durationMs: Date.now() - startMs };
    }

    const universeMap = new Map(universeRows.map(r => [r.id, r]));

    // Phase 7C: load latest trust data (inert if unavailable)
    const trustMap = await this.loadTrustMap(logger);

    const updates: ModelScoreUpdate[] = [];
    let skipped = 0;
    let errors = 0;
    let trustAdjusted = 0;

    for (const candidate of candidates) {
      try {
        const universe = universeMap.get(candidate.universe_id);
        if (!universe) { skipped++; continue; }
        if (universe.fair_over_prob === null && universe.fair_under_prob === null) { skipped++; continue; }
        if (universe.is_stale) { skipped++; continue; }

        // Choose the side with higher fair probability (board scan already filtered to >50%)
        const overProb = universe.fair_over_prob ?? 0;
        const underProb = universe.fair_under_prob ?? 0;
        const p_market_devig = overProb >= underProb ? overProb : underProb;

        if (p_market_devig < 0.5) { skipped++; continue; }

        // Phase 3 baseline: no sharp consensus data, no movement signal
        const blend = computeModelBlend(p_market_devig, p_market_devig, 0, 0);
        let model_score = Math.max(0, Math.min(1, blend.p_final_v2));

        // Phase 7C: bounded trust adjustment
        const trustRow = universe.market_type_id ? trustMap.get(universe.market_type_id) : null;
        if (trustRow && trustRow.sample_size >= MIN_TRUST_SAMPLE_SIZE && trustRow.win_rate !== null) {
          const trustSignal = trustRow.win_rate - 0.5; // deviation from breakeven
          const adjustment = Math.max(-MAX_TRUST_ADJUSTMENT, Math.min(MAX_TRUST_ADJUSTMENT, trustSignal * 0.1));
          model_score = Math.max(0, Math.min(1, model_score + adjustment));
          trustAdjusted++;
        }

        const edge = model_score - 0.5;

        const bandResult = initialBandAssignment({
          edge,
          uncertainty: 0.2,
          clvForecast: 0,
          liquidityTier: 'unknown',
          selectionDecision: 'select',
          selectionScore: model_score * 100,
        });

        updates.push({
          id: candidate.id,
          model_score,
          model_tier: bandResult.band,
          model_confidence: Math.max(0, 1 - 0.2),
        });

        // Flush in batches
        if (updates.length >= batchSize) {
          await this.repos.pickCandidates.updateModelScoreBatch(updates.splice(0, updates.length));
        }
      } catch (err) {
        errors++;
        logger?.error?.(JSON.stringify({
          service: 'candidate-scoring',
          event: 'score_error',
          candidateId: candidate.id,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    }

    // Flush remainder
    if (updates.length > 0) {
      try {
        await this.repos.pickCandidates.updateModelScoreBatch(updates);
      } catch (err) {
        errors++;
        logger?.error?.(JSON.stringify({
          service: 'candidate-scoring',
          event: 'flush_failed',
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    }

    const scored = candidates.length - skipped - errors;
    logger?.info?.(JSON.stringify({
      service: 'candidate-scoring',
      event: 'run.completed',
      scored,
      skipped,
      errors,
      trustAdjusted,
      durationMs: Date.now() - startMs,
    }));

    return { scored, skipped, errors, trustAdjusted, durationMs: Date.now() - startMs };
  }

  /**
   * Load the latest market-family trust run into a map keyed by market_type_id.
   * Returns empty map if trust repo is unavailable or the load fails (inert).
   */
  private async loadTrustMap(
    logger?: Pick<Console, 'info' | 'warn' | 'error'>,
  ): Promise<Map<string, MarketFamilyTrustRow>> {
    const map = new Map<string, MarketFamilyTrustRow>();
    if (!this.repos.marketFamilyTrust) return map;

    try {
      const rows = await this.repos.marketFamilyTrust.listLatestRun();
      for (const row of rows) {
        map.set(row.market_type_id, row);
      }
    } catch (err) {
      logger?.warn?.(JSON.stringify({
        service: 'candidate-scoring',
        event: 'trust_load_failed',
        error: err instanceof Error ? err.message : String(err),
        note: 'scoring continues without trust adjustment',
      }));
    }

    return map;
  }
}

export async function runCandidateScoring(
  repos: {
    pickCandidates: IPickCandidateRepository;
    marketUniverse: IMarketUniverseRepository;
    marketFamilyTrust?: IMarketFamilyTrustRepository;
  },
  options: ScoringOptions = {},
): Promise<ScoringResult> {
  return new CandidateScoringService(repos).run(options);
}
