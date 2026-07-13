/**
 * Boost Analyzer data contract — TYPES ONLY.
 *
 * TODO(data-contract): No boost/promo data source exists in Unit Talk V2.
 * There is no boosts table in Supabase and no ingestion path for sportsbook
 * promos. Before /intel/boosts can populate, we need:
 *   1. A `book_boosts` table (or equivalent) with the fields below,
 *   2. An ingestion source (manual operator entry or a provider feed),
 *   3. A data module in src/lib/data/ reading it via getDataClient().
 * Until then the page renders an EmptyState shell with a column-complete table.
 */

export type BoostRecommendation = 'Pass' | 'Review' | 'Approve';

export interface BoostEntry {
  id: string;
  /** bookmaker_key-style identifier, e.g. 'draftkings' */
  bookmakerKey: string;
  boostName: string;
  /** American odds before the boost */
  originalOdds: number;
  /** American odds after the boost */
  boostedOdds: number;
  /** Implied probability of the boosted price (vig included), 0..1 */
  impliedProbability: number;
  /** Fair American odds from internal consensus de-vig — UNCERTIFIED */
  fairOdds: number | null;
  /** Estimated EV% at the boosted price vs fair — UNCERTIFIED */
  estimatedEvPercent: number | null;
  /** Maximum stake the book allows on the boost, in book currency units */
  maxStake: number | null;
  /** ISO timestamp when the boost expires */
  expiresAt: string | null;
  /** Raw terms & conditions text as published by the book */
  terms: string | null;
  recommendation: BoostRecommendation;
  /** ISO timestamp the entry was recorded */
  recordedAt: string;
}
