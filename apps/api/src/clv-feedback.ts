import type { PickRepository, SettlementRepository, IMarketFamilyTrustRepository, ClvFeedbackInsert } from '@unit-talk/db';
import crypto from 'node:crypto';

export interface ClvTrustAdjustment {
  adjustment: number; // -10 to +10 added to trust score
  sampleSize: number;
  avgClvPercent: number;
  reason: string;
}

export interface MarketFamilyClvFeedback {
  market_type_id: string;
  sport_key: string | null;
  sample_size: number;
  avg_clv_percent: number;
}

export interface ClvTrustAdjustmentOptions {
  lookbackDays?: number;
  minSampleSize?: number;
}

/**
 * Compute a trust-score adjustment based on historical CLV data from settled picks.
 *
 * Queries recent grading settlements for the given capper (matched by pick
 * metadata.capper — the canonical capper identity, NOT pick.source which is
 * the intake channel like 'smart-form' or 'discord-bot').
 *
 * Returns `null` when insufficient data is available (fail-open — trust score unchanged).
 */
export async function computeClvTrustAdjustment(
  submittedBy: string,
  settlementRepository: SettlementRepository,
  pickRepository: PickRepository,
  options?: ClvTrustAdjustmentOptions,
): Promise<ClvTrustAdjustment | null> {
  const lookbackDays = options?.lookbackDays ?? 30;
  const minSampleSize = options?.minSampleSize ?? 10;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - lookbackDays);
  const cutoffIso = cutoff.toISOString();

  const recentSettlements = await settlementRepository.listRecent(500);

  const gradingSettlements = recentSettlements.filter(
    (s) => s.source === 'grading' && s.settled_at >= cutoffIso,
  );

  const clvValues: number[] = [];

  for (const settlement of gradingSettlements) {
    const pick = await pickRepository.findPickById(settlement.pick_id);
    if (!pick) continue;

    const pickMetadata = asRecord(pick.metadata);
    const pickCapper = typeof pickMetadata['capper'] === 'string' ? pickMetadata['capper'] : pick.source;
    if (pickCapper !== submittedBy) {
      continue;
    }

    const payload = asRecord(settlement.payload);
    const clvPercent = readFiniteNumber(payload['clvPercent']);
    if (clvPercent !== null) {
      clvValues.push(clvPercent);
    }
  }

  if (clvValues.length < minSampleSize) {
    return null;
  }

  const avgClvPercent =
    clvValues.reduce((sum, v) => sum + v, 0) / clvValues.length;

  let adjustment: number;
  let reason: string;

  if (avgClvPercent > 2) {
    adjustment = 10;
    reason = `Strong positive CLV (avg ${avgClvPercent.toFixed(2)}% over ${clvValues.length} picks)`;
  } else if (avgClvPercent > 0) {
    adjustment = 5;
    reason = `Marginally positive CLV (avg ${avgClvPercent.toFixed(2)}% over ${clvValues.length} picks)`;
  } else if (avgClvPercent < -2) {
    adjustment = -10;
    reason = `Strong negative CLV (avg ${avgClvPercent.toFixed(2)}% over ${clvValues.length} picks)`;
  } else if (avgClvPercent < 0) {
    adjustment = -5;
    reason = `Marginally negative CLV (avg ${avgClvPercent.toFixed(2)}% over ${clvValues.length} picks)`;
  } else {
    adjustment = 0;
    reason = `Neutral CLV (avg ${avgClvPercent.toFixed(2)}% over ${clvValues.length} picks)`;
  }

  return {
    adjustment,
    sampleSize: clvValues.length,
    avgClvPercent,
    reason,
  };
}

/**
 * Phase 7C UTV2-517: Compute and persist market-family CLV feedback.
 *
 * Aggregates CLV data from recent settled picks by market (derived from pick metadata),
 * then writes the aggregates through the governed market_family_trust persistence path
 * using insertClvFeedback. Append-only, idempotent per feedback_run_id.
 *
 * Returns the feedback rows written (empty if insufficient data).
 */
export async function computeAndPersistMarketFamilyClvFeedback(
  settlementRepository: SettlementRepository,
  pickRepository: PickRepository,
  marketFamilyTrustRepository: IMarketFamilyTrustRepository,
  options?: ClvTrustAdjustmentOptions,
): Promise<MarketFamilyClvFeedback[]> {
  const lookbackDays = options?.lookbackDays ?? 30;
  const minSampleSize = options?.minSampleSize ?? 5;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - lookbackDays);
  const cutoffIso = cutoff.toISOString();

  const recentSettlements = await settlementRepository.listRecent(500);
  const gradingSettlements = recentSettlements.filter(
    (s) => s.source === 'grading' && s.settled_at >= cutoffIso,
  );

  // Aggregate CLV by market key
  const marketAgg = new Map<string, { sport: string | null; clvValues: number[] }>();

  for (const settlement of gradingSettlements) {
    const pick = await pickRepository.findPickById(settlement.pick_id);
    if (!pick) continue;

    const pickMetadata = asRecord(pick.metadata);
    const market = typeof pick.market === 'string' ? pick.market : null;
    if (!market) continue;

    const payload = asRecord(settlement.payload);
    const clvPercent = readFiniteNumber(payload['clvPercent']);
    if (clvPercent === null) continue;

    const existing = marketAgg.get(market);
    if (existing) {
      existing.clvValues.push(clvPercent);
    } else {
      const sport = typeof pickMetadata['sport'] === 'string' ? pickMetadata['sport'] : null;
      marketAgg.set(market, { sport, clvValues: [clvPercent] });
    }
  }

  // Build feedback rows for markets with sufficient samples
  const feedbackRows: MarketFamilyClvFeedback[] = [];
  const feedbackRunId = crypto.randomUUID();
  const inserts: ClvFeedbackInsert[] = [];

  for (const [marketTypeId, agg] of marketAgg) {
    if (agg.clvValues.length < minSampleSize) continue;

    const avgClv = agg.clvValues.reduce((sum, v) => sum + v, 0) / agg.clvValues.length;
    const row: MarketFamilyClvFeedback = {
      market_type_id: marketTypeId,
      sport_key: agg.sport,
      sample_size: agg.clvValues.length,
      avg_clv_percent: avgClv,
    };
    feedbackRows.push(row);
    inserts.push({
      market_type_id: marketTypeId,
      sport_key: agg.sport,
      sample_size: agg.clvValues.length,
      avg_clv_percent: avgClv,
      feedback_run_id: feedbackRunId,
    });
  }

  if (inserts.length > 0) {
    await marketFamilyTrustRepository.insertClvFeedback(inserts);
  }

  return feedbackRows;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
}
