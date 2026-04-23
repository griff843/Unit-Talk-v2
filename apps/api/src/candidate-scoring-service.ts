/**
 * Candidate Scoring Service — Phase 7D Real Model Layer
 *
 * Reads pick_candidates with status='qualified' and model_score=NULL,
 * loads the champion model from the registry for each sport/market family,
 * computes model_score/model_tier/model_confidence, and writes scores back.
 *
 * Phase 7C: bounded market-family trust adjustments.
 * Phase 7D: registry-backed champion models, real confidence, shadow comparison.
 * Phase 7E: calibration metrics, legacy fallback removed (fail-closed).
 *
 * Hard boundaries (never violate):
 * - Never sets pick_id
 * - Never sets shadow_mode=false
 * - Never writes to picks table
 * - Never calls promotion/distribution/settlement services
 */

import {
  computeModelBlend,
  evaluateAvailabilityConfidence,
  initialBandAssignment,
  type PlayerAvailability,
} from '@unit-talk/domain';
import type {
  IPickCandidateRepository,
  IMarketUniverseRepository,
  IMarketFamilyTrustRepository,
  MarketFamilyTrustRow,
  ModelRegistryRepository,
  ModelRegistryRecord,
  ExperimentLedgerRepository,
  ModelScoreUpdate,
  ParticipantRepository,
  ParticipantRow,
} from '@unit-talk/db';

export interface ScoringResult {
  scored: number;
  skipped: number;
  errors: number;
  trustAdjusted: number;
  availabilityAdjusted: number;
  availabilityNoDataSkipped: number;
  availabilitySuppressed: number;
  championResolved: number;
  noChampionSkipped: number;
  shadowRecorded: number;
  calibration: {
    scoredCount: number;
    avgModelScore: number;
    trustFamiliesAvailable: number;
    avgTrustWinRate: number | null;
    totalTrustSampleSize: number;
  } | null;
  durationMs: number;
}

export interface ScoringOptions {
  batchSize?: number;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  /**
   * Candidate statuses to score. Defaults to qualified only for live safety.
   * Proof/shadow runs can explicitly include rejected rows without changing
   * promotion, ranking, pick creation, or distribution behavior.
   */
  statuses?: string[];
}

/** Minimum sample size for a trust row to influence scoring. */
const MIN_TRUST_SAMPLE_SIZE = 5;

/** Maximum absolute trust adjustment to model_score (bounded). */
const MAX_TRUST_ADJUSTMENT = 0.05;

/** Default confidence when champion model has no explicit confidence metadata. */
const DEFAULT_CHAMPION_CONFIDENCE = 0.75;

/**
 * Derive the market family from a market_type_id.
 * Convention: player_* → player_prop, game-level → game_line, combo → combo.
 */
function deriveMarketFamily(marketTypeId: string | null): string | null {
  if (!marketTypeId) return null;
  if (marketTypeId.startsWith('player_')) return 'player_prop';
  if (marketTypeId.includes('spread') || marketTypeId.includes('total') || marketTypeId.includes('moneyline')) return 'game_line';
  if (marketTypeId.includes('batting') || marketTypeId.includes('combo')) return 'combo';
  return 'player_prop'; // default for unknown market types in the governed pipeline
}

export class CandidateScoringService {
  constructor(
    private readonly repos: {
      pickCandidates: IPickCandidateRepository;
      marketUniverse: IMarketUniverseRepository;
      marketFamilyTrust?: IMarketFamilyTrustRepository;
      modelRegistry?: ModelRegistryRepository;
      experimentLedger?: ExperimentLedgerRepository;
      participants?: ParticipantRepository;
    },
  ) {}

  async run(options: ScoringOptions = {}): Promise<ScoringResult> {
    const startMs = Date.now();
    const batchSize = options.batchSize ?? 200;
    const logger = options.logger;

    let candidates;
    try {
      const statuses = normalizeCandidateStatuses(options.statuses);
      const rowsByStatus = await Promise.all(
        statuses.map((status) => this.repos.pickCandidates.findByStatus(status)),
      );
      const all = rowsByStatus.flat();
      candidates = all.filter(c => c.model_score === null);
    } catch (err) {
      logger?.error?.(JSON.stringify({
        service: 'candidate-scoring',
        event: 'load_failed',
        error: err instanceof Error ? err.message : String(err),
      }));
      return makeEmptyResult({ errors: 1, durationMs: Date.now() - startMs });
    }

    if (candidates.length === 0) {
      logger?.info?.(JSON.stringify({ service: 'candidate-scoring', event: 'no_unscored_candidates' }));
      return makeEmptyResult({ durationMs: Date.now() - startMs });
    }

    // Bulk-load market universe rows
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
      return makeEmptyResult({
        skipped: candidates.length,
        errors: 1,
        durationMs: Date.now() - startMs,
      });
    }

    const universeMap = new Map(universeRows.map(r => [r.id, r]));
    const trustMap = await this.loadTrustMap(logger);
    const championCache = new Map<string, ModelRegistryRecord | null>();

    const updates: ModelScoreUpdate[] = [];
    let skipped = 0;
    let errors = 0;
    let trustAdjusted = 0;
    let availabilityAdjusted = 0;
    let availabilityNoDataSkipped = 0;
    let availabilitySuppressed = 0;
    let championResolved = 0;
    let noChampionSkipped = 0;
    let shadowRecorded = 0;
    const scoredModelScores: number[] = [];

    for (const candidate of candidates) {
      try {
        const universe = universeMap.get(candidate.universe_id);
        if (!universe) { skipped++; continue; }
        if (universe.fair_over_prob === null && universe.fair_under_prob === null) { skipped++; continue; }
        if (universe.is_stale) { skipped++; continue; }

        const overProb = universe.fair_over_prob ?? 0;
        const underProb = universe.fair_under_prob ?? 0;
        const p_market_devig = overProb >= underProb ? overProb : underProb;
        if (p_market_devig < 0.5) { skipped++; continue; }

        // Phase 7D: resolve champion model from registry
        const marketFamily = deriveMarketFamily(universe.market_type_id);
        const champion = await this.resolveChampion(universe.sport_key, marketFamily, championCache);

        // Phase 7D: use champion metadata for blend weights if available
        const championMeta = champion ? asRecord(champion.metadata) : null;
        const sharpWeight = readFiniteNumber(championMeta?.['sharp_weight']) ?? 0;
        const movementWeight = readFiniteNumber(championMeta?.['movement_weight']) ?? 0;

        const blend = computeModelBlend(p_market_devig, p_market_devig, sharpWeight, movementWeight);
        let model_score = Math.max(0, Math.min(1, blend.p_final_v2));

        if (champion) championResolved++;

        // Phase 7C: bounded trust adjustment
        const trustRow = universe.market_type_id ? trustMap.get(universe.market_type_id) : null;
        if (trustRow && trustRow.sample_size >= MIN_TRUST_SAMPLE_SIZE && trustRow.win_rate !== null) {
          const trustSignal = trustRow.win_rate - 0.5;
          const adjustment = Math.max(-MAX_TRUST_ADJUSTMENT, Math.min(MAX_TRUST_ADJUSTMENT, trustSignal * 0.1));
          model_score = Math.max(0, Math.min(1, model_score + adjustment));
          trustAdjusted++;
        }

        // Phase 7E UTV2-553: fail-closed — no champion means no scoring
        if (!champion) {
          skipped++;
          noChampionSkipped++;
          logger?.info?.(JSON.stringify({
            service: 'candidate-scoring',
            event: 'no_champion_skip',
            candidateId: candidate.id,
            sport: universe.sport_key,
            marketFamily,
          }));
          continue;
        }

        // Phase 7D: confidence from champion metadata
        const championConfidence = readFiniteNumber(championMeta?.['confidence']);
        const uncertainty = 1 - (championConfidence ?? DEFAULT_CHAMPION_CONFIDENCE);

        const edge = model_score - 0.5;
        const bandResult = initialBandAssignment({
          edge,
          uncertainty,
          clvForecast: 0,
          liquidityTier: 'unknown',
          selectionDecision: 'select',
          selectionScore: model_score * 100,
        });

        let model_confidence = Math.max(0, 1 - uncertainty);
        const availability = await this.evaluateAvailability(universe, logger);
        if (availability.status === 'missing') {
          skipped++;
          availabilityNoDataSkipped++;
          logger?.info?.(JSON.stringify({
            service: 'candidate-scoring',
            event: 'availability_no_data_skip',
            candidateId: candidate.id,
            participantId: universe.participant_id,
            reason: availability.reason,
          }));
          continue;
        }
        if (availability.status === 'suppress') {
          skipped++;
          availabilitySuppressed++;
          logger?.info?.(JSON.stringify({
            service: 'candidate-scoring',
            event: 'availability_suppressed',
            candidateId: candidate.id,
            participantId: universe.participant_id,
            reason: availability.reason,
          }));
          continue;
        }
        if (availability.status === 'adjust') {
          model_score = Math.max(0, Math.min(1, model_score * availability.confidenceMultiplier));
          model_confidence = Math.max(0, Math.min(1, model_confidence * availability.confidenceMultiplier));
          availabilityAdjusted++;
        }

        updates.push({
          id: candidate.id,
          model_score,
          model_tier: bandResult.band,
          model_confidence,
        });
        scoredModelScores.push(model_score);

        // Phase 7D: shadow comparison — record if both champion and shadow exist
        if (champion && this.repos.experimentLedger) {
          const shadowRecordResult = await this.recordShadowComparison(
            candidate.id,
            universe.sport_key,
            marketFamily,
            champion,
            model_score,
            bandResult.band,
            availability.status === 'adjust' ? availability : null,
            logger,
          );
          if (shadowRecordResult) shadowRecorded++;
        }

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

    // Phase 7E UTV2-552: calibration metrics from trust data + scoring distribution
    const trustRows = [...trustMap.values()].filter(r => r.sample_size >= MIN_TRUST_SAMPLE_SIZE);
    const calibration = scoredModelScores.length > 0
      ? {
          scoredCount: scoredModelScores.length,
          avgModelScore: Math.round((scoredModelScores.reduce((s, v) => s + v, 0) / scoredModelScores.length) * 1e4) / 1e4,
          trustFamiliesAvailable: trustRows.length,
          avgTrustWinRate: trustRows.length > 0
            ? Math.round((trustRows.reduce((s, r) => s + (r.win_rate ?? 0), 0) / trustRows.length) * 1e4) / 1e4
            : null,
          totalTrustSampleSize: trustRows.reduce((s, r) => s + r.sample_size, 0),
        }
      : null;

    logger?.info?.(JSON.stringify({
      service: 'candidate-scoring',
      event: 'run.completed',
      scored, skipped, errors, trustAdjusted, championResolved, noChampionSkipped, shadowRecorded,
      availabilityAdjusted, availabilityNoDataSkipped, availabilitySuppressed,
      calibration,
      durationMs: Date.now() - startMs,
    }));

    return {
      scored,
      skipped,
      errors,
      trustAdjusted,
      availabilityAdjusted,
      availabilityNoDataSkipped,
      availabilitySuppressed,
      championResolved,
      noChampionSkipped,
      shadowRecorded,
      calibration,
      durationMs: Date.now() - startMs,
    };
  }

  private async evaluateAvailability(
    universe: { participant_id: string | null; market_type_id: string | null },
    logger?: Pick<Console, 'info' | 'warn' | 'error'>,
  ): Promise<CandidateAvailabilityDecision> {
    if (!this.repos.participants || !isPlayerPropMarket(universe.market_type_id)) {
      return { status: 'not_applicable' };
    }

    if (!universe.participant_id) {
      return { status: 'missing', reason: 'missing_participant_id' };
    }

    let participant: ParticipantRow | null = null;
    try {
      participant = await this.repos.participants.findById(universe.participant_id);
    } catch (err) {
      logger?.warn?.(JSON.stringify({
        service: 'candidate-scoring',
        event: 'availability_load_failed',
        participantId: universe.participant_id,
        error: err instanceof Error ? err.message : String(err),
      }));
      return { status: 'missing', reason: 'availability_load_failed' };
    }

    const availability = readAvailabilityFromParticipant(participant);
    if (!availability) {
      return { status: 'missing', reason: 'availability_no_data' };
    }

    const evaluated = evaluateAvailabilityConfidence(availability);
    if (evaluated.recommendationAdjustment === 'suppress' || evaluated.recommendationAdjustment === 'hold') {
      return {
        status: 'suppress',
        reason: evaluated.reason,
        confidenceMultiplier: evaluated.confidenceMultiplier,
        recommendationAdjustment: evaluated.recommendationAdjustment,
      };
    }

    if (
      evaluated.recommendationAdjustment === 'reduce_stake' ||
      evaluated.confidenceMultiplier < 1
    ) {
      return {
        status: 'adjust',
        reason: evaluated.reason,
        confidenceMultiplier: evaluated.confidenceMultiplier,
        recommendationAdjustment: evaluated.recommendationAdjustment,
      };
    }

    return { status: 'ok', reason: evaluated.reason };
  }

  private async resolveChampion(
    sport: string,
    marketFamily: string | null,
    cache: Map<string, ModelRegistryRecord | null>,
  ): Promise<ModelRegistryRecord | null> {
    if (!this.repos.modelRegistry || !marketFamily) return null;
    const cacheKey = `${sport}:${marketFamily}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;

    try {
      const champion = await this.repos.modelRegistry.findChampion(sport, marketFamily);
      cache.set(cacheKey, champion);
      return champion;
    } catch {
      cache.set(cacheKey, null);
      return null;
    }
  }

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

  /**
   * Phase 7D UTV2-505: Record shadow-vs-champion comparison in experiment ledger.
   * Shadow remains informational — does not affect production routing.
   */
  private async recordShadowComparison(
    candidateId: string,
    sport: string,
    marketFamily: string | null,
    champion: ModelRegistryRecord,
    championScore: number,
    championTier: string,
    availability: Extract<CandidateAvailabilityDecision, { status: 'adjust' }> | null,
    logger?: Pick<Console, 'info' | 'warn' | 'error'>,
  ): Promise<boolean> {
    if (!this.repos.experimentLedger || !marketFamily) return false;

    try {
      const experiment = await this.repos.experimentLedger.create({
        modelId: champion.id,
        runType: 'shadow_comparison',
        sport,
        marketFamily,
        notes: `candidate=${candidateId}`,
      });

      await this.repos.experimentLedger.complete(experiment.id, {
        candidateId,
        championModelId: champion.id,
        championModelName: champion.model_name,
        championScore,
        championTier,
        shadowScore: null, // no shadow model scored yet — placeholder for future shadow runner
        comparisonType: 'champion_only',
        availabilityAdjustment: availability
          ? {
              confidenceMultiplier: availability.confidenceMultiplier,
              recommendationAdjustment: availability.recommendationAdjustment,
              reason: availability.reason,
            }
          : null,
      });

      return true;
    } catch (err) {
      logger?.warn?.(JSON.stringify({
        service: 'candidate-scoring',
        event: 'shadow_comparison_failed',
        candidateId,
        error: err instanceof Error ? err.message : String(err),
      }));
      return false;
    }
  }
}

function normalizeCandidateStatuses(statuses: string[] | undefined) {
  const requested = statuses && statuses.length > 0 ? statuses : ['qualified'];
  return Array.from(new Set(requested.map((status) => status.trim()).filter(Boolean)));
}

export async function runCandidateScoring(
  repos: {
    pickCandidates: IPickCandidateRepository;
    marketUniverse: IMarketUniverseRepository;
    marketFamilyTrust?: IMarketFamilyTrustRepository;
    modelRegistry?: ModelRegistryRepository;
    experimentLedger?: ExperimentLedgerRepository;
    participants?: ParticipantRepository;
  },
  options: ScoringOptions = {},
): Promise<ScoringResult> {
  return new CandidateScoringService(repos).run(options);
}

type CandidateAvailabilityDecision =
  | { status: 'not_applicable' }
  | { status: 'ok'; reason: string }
  | { status: 'missing'; reason: string }
  | {
      status: 'adjust';
      reason: string;
      confidenceMultiplier: number;
      recommendationAdjustment: 'none' | 'reduce_stake' | 'hold' | 'suppress';
    }
  | {
      status: 'suppress';
      reason: string;
      confidenceMultiplier: number;
      recommendationAdjustment: 'hold' | 'suppress';
    };

function isPlayerPropMarket(marketTypeId: string | null): boolean {
  return marketTypeId?.startsWith('player_') === true;
}

function readAvailabilityFromParticipant(participant: ParticipantRow | null): PlayerAvailability | null {
  if (!participant) return null;
  const metadata = asRecord(participant.metadata);
  const rawAvailability = asRecord(metadata['availability']);
  const status = readAvailabilityStatus(rawAvailability['status']);
  const lastUpdatedAt = readString(rawAvailability['lastUpdatedAt']);

  if (!status || !lastUpdatedAt) {
    return null;
  }

  const result: PlayerAvailability = {
    participantId: participant.id,
    status,
    lastUpdatedAt,
  };
  const injuryNote = readString(rawAvailability['injuryNote']);
  if (injuryNote) result.injuryNote = injuryNote;
  const source = readString(rawAvailability['source']);
  if (source) result.source = source;
  return result;
}

function readAvailabilityStatus(value: unknown): PlayerAvailability['status'] | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'confirmed' ||
    normalized === 'probable' ||
    normalized === 'questionable' ||
    normalized === 'doubtful' ||
    normalized === 'out' ||
    normalized === 'unknown'
  ) {
    return normalized;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function makeEmptyResult(overrides: Partial<ScoringResult> = {}): ScoringResult {
  return {
    scored: 0,
    skipped: 0,
    errors: 0,
    trustAdjusted: 0,
    availabilityAdjusted: 0,
    availabilityNoDataSkipped: 0,
    availabilitySuppressed: 0,
    championResolved: 0,
    noChampionSkipped: 0,
    shadowRecorded: 0,
    calibration: null,
    durationMs: 0,
    ...overrides,
  };
}

