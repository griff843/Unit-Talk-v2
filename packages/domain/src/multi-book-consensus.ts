/**
 * Multi-book consensus computation.
 *
 * Aggregates odds from multiple providers for the same market/event/participant
 * into a consensus view. Used for:
 *   - Detecting line discrepancies between books
 *   - Computing fair value from multi-book data
 *   - Identifying stale or outlier lines
 *
 * Pure computation — no DB, no I/O.
 */

export interface ProviderOddsSnapshot {
  providerKey: string;
  overOdds: number | null;
  underOdds: number | null;
  line: number | null;
  snapshotAt: string;
}

export interface MultiBookConsensusResult {
  /** Number of providers with data for this market */
  providerCount: number;
  /** Provider keys that contributed */
  providers: string[];
  /** Consensus line (median of provider lines) */
  consensusLine: number | null;
  /** Consensus over odds (median of provider over odds) */
  consensusOverOdds: number | null;
  /** Consensus under odds (median of provider under odds) */
  consensusUnderOdds: number | null;
  /** Max spread between any two providers' over odds */
  maxOddsSpread: number | null;
  /** Max spread between any two providers' lines */
  maxLineSpread: number | null;
  /** Whether significant discrepancy exists (odds spread > threshold) */
  hasDiscrepancy: boolean;
  /** Per-provider breakdown */
  breakdown: ProviderOddsSnapshot[];
}

const DISCREPANCY_ODDS_THRESHOLD = 20; // 20-cent spread in American odds

/**
 * Compute multi-book consensus from a set of provider snapshots
 * for the same market/event/participant.
 */
export function computeMultiBookConsensus(
  snapshots: ProviderOddsSnapshot[],
): MultiBookConsensusResult {
  if (snapshots.length === 0) {
    return {
      providerCount: 0,
      providers: [],
      consensusLine: null,
      consensusOverOdds: null,
      consensusUnderOdds: null,
      maxOddsSpread: null,
      maxLineSpread: null,
      hasDiscrepancy: false,
      breakdown: [],
    };
  }

  const providers = [...new Set(snapshots.map((s) => s.providerKey))];
  const lines = snapshots.map((s) => s.line).filter((l): l is number => l != null);
  const overOdds = snapshots.map((s) => s.overOdds).filter((o): o is number => o != null);
  const underOdds = snapshots.map((s) => s.underOdds).filter((u): u is number => u != null);

  const consensusLine = lines.length > 0 ? median(lines) : null;
  const consensusOverOdds = overOdds.length > 0 ? median(overOdds) : null;
  const consensusUnderOdds = underOdds.length > 0 ? median(underOdds) : null;

  const maxOddsSpread = overOdds.length >= 2 ? Math.max(...overOdds) - Math.min(...overOdds) : null;
  const maxLineSpread = lines.length >= 2 ? Math.max(...lines) - Math.min(...lines) : null;

  return {
    providerCount: providers.length,
    providers,
    consensusLine,
    consensusOverOdds,
    consensusUnderOdds,
    maxOddsSpread,
    maxLineSpread,
    hasDiscrepancy: maxOddsSpread != null && Math.abs(maxOddsSpread) > DISCREPANCY_ODDS_THRESHOLD,
    breakdown: snapshots,
  };
}

/**
 * Group provider offers by market key + participant, then compute consensus for each.
 */
export function computeConsensusFromOffers(
  offers: Array<{
    providerKey: string;
    providerMarketKey: string;
    providerParticipantId: string | null;
    overOdds: number | null;
    underOdds: number | null;
    line: number | null;
    snapshotAt: string;
  }>,
): Map<string, MultiBookConsensusResult> {
  const grouped = new Map<string, ProviderOddsSnapshot[]>();

  for (const offer of offers) {
    const key = `${offer.providerMarketKey}:${offer.providerParticipantId ?? 'all'}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push({
      providerKey: offer.providerKey,
      overOdds: offer.overOdds,
      underOdds: offer.underOdds,
      line: offer.line,
      snapshotAt: offer.snapshotAt,
    });
  }

  const results = new Map<string, MultiBookConsensusResult>();
  for (const [key, snapshots] of grouped) {
    results.set(key, computeMultiBookConsensus(snapshots));
  }
  return results;
}

/**
 * Detect markets where provider odds diverge significantly.
 * Useful for alerting operators to potential arbitrage or stale lines.
 */
export function detectOddsDiscrepancies(
  consensusMap: Map<string, MultiBookConsensusResult>,
): Array<{ marketKey: string; consensus: MultiBookConsensusResult }> {
  const discrepancies: Array<{ marketKey: string; consensus: MultiBookConsensusResult }> = [];
  for (const [marketKey, consensus] of consensusMap) {
    if (consensus.hasDiscrepancy) {
      discrepancies.push({ marketKey, consensus });
    }
  }
  return discrepancies;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}
