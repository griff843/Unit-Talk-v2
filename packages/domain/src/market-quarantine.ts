import type { ScoredOutcome, QuarantinedMarketSummary } from './outcomes/types.js';

export type MarketClassification = 'trusted' | 'unsupported';

/**
 * A record is "trusted" when its market_type_key is resolved.
 * Absence means the scoring pipeline could not map this market to a canonical
 * key — edge analytics should not treat these picks as validated signals.
 */
export function classifyMarket(record: ScoredOutcome): MarketClassification {
  return record.market_type_key !== undefined ? 'trusted' : 'unsupported';
}

export function buildQuarantineSummary(records: ScoredOutcome[]): QuarantinedMarketSummary {
  const unsupported = records.filter((r) => classifyMarket(r) === 'unsupported');
  const ids = [...new Set(unsupported.map((r) => r.market_type_id))].sort((a, b) => a - b);
  return {
    unsupported_count: unsupported.length,
    unsupported_market_type_ids: ids,
  };
}
