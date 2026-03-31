import type { PickRepository, SettlementRepository } from '@unit-talk/db';

export interface ClvTrustAdjustment {
  adjustment: number; // -10 to +10 added to trust score
  sampleSize: number;
  avgClvPercent: number;
  reason: string;
}

export interface ClvTrustAdjustmentOptions {
  lookbackDays?: number;
  minSampleSize?: number;
}

/**
 * Compute a trust-score adjustment based on historical CLV data from settled picks.
 *
 * Queries recent grading settlements for the given capper (matched by `picks.source`),
 * extracts CLV data from settlement payloads, and returns a signed adjustment
 * that should be added to the base trust score.
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

  // Fetch a generous batch of recent settlements to filter locally.
  // The repository only exposes listRecent(limit), so we pull enough rows
  // to cover the lookback window.
  const recentSettlements = await settlementRepository.listRecent(500);

  // Filter to grading-source settlements within the lookback window.
  const gradingSettlements = recentSettlements.filter(
    (s) => s.source === 'grading' && s.settled_at >= cutoffIso,
  );

  // Cross-reference with picks to match the capper (submittedBy → picks.source).
  const clvValues: number[] = [];

  for (const settlement of gradingSettlements) {
    const pick = await pickRepository.findPickById(settlement.pick_id);
    if (!pick || pick.source !== submittedBy) {
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
