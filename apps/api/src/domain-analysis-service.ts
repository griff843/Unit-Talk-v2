/**
 * Domain Analysis Service — submission-time enrichment using salvaged domain modules
 *
 * Computes implied probability, edge, and Kelly sizing from a pick's American odds
 * and confidence. Results are stored in pick.metadata.domainAnalysis for downstream
 * consumption (operator dashboards, analytics, future scoring inputs).
 *
 * PURE COMPUTATION: No I/O, no DB, no side effects.
 * FAIL-OPEN: Returns null if odds are missing or invalid.
 */

import type { CanonicalPick } from '@unit-talk/contracts';
import {
  americanToImplied,
  americanToDecimal,
  computeKellyFraction,
  roundTo,
} from '@unit-talk/domain';

export interface DomainAnalysis {
  /** Implied win probability from American odds (via proportional devig) */
  impliedProbability: number;
  /** Decimal odds converted from American odds */
  decimalOdds: number;
  /** Domain analysis model version */
  version: string;
  /** Timestamp of analysis computation */
  computedAt: string;
  /**
   * Confidence delta: confidence - impliedProbability from submitted odds.
   * This is a confidence assertion, NOT market edge.
   * When realEdge is available, use that for promotion scoring.
   *
   * @deprecated Use `confidenceDelta`. This alias is kept for backward compat with
   * existing picks in the DB that have `metadata.domainAnalysis.edge`.
   */
  edge?: number | undefined;
  /**
   * Confidence delta (canonical name): confidence - impliedProbability.
   * Same value as `edge`. Prefer this over `edge` in new code.
   * This is a confidence assertion, NOT real market edge.
   */
  confidenceDelta?: number | undefined;
  /** Whether confidence delta is positive */
  hasPositiveEdge?: boolean | undefined;
  /** Fractional Kelly bet sizing (only if confidence and odds present) */
  kellyFraction?: number | undefined;
  /**
   * Real edge: model probability vs devigged market consensus.
   * Available when Pinnacle, multi-book, SGO, or single-book data exists.
   * This IS market edge — use for promotion scoring when present.
   */
  realEdge?: number | undefined;
  /** Source of the real edge (pinnacle, consensus, sgo, single-book, confidence-delta) */
  realEdgeSource?: string | undefined;
  /** Market probability used for real edge computation */
  marketProbability?: number | undefined;
  /** Whether real edge is positive */
  hasRealEdge?: boolean | undefined;
  /** Number of books in consensus */
  realEdgeBookCount?: number | undefined;
}

export const DOMAIN_ANALYSIS_VERSION = 'domain-analysis-v1.0.0';

/**
 * Compute domain analysis for a canonical pick at submission time.
 *
 * Returns null if:
 * - odds are missing or undefined
 * - odds produce invalid implied probability (0 or 1)
 * - decimal odds are <= 1 (invalid for Kelly)
 */
export function computeSubmissionDomainAnalysis(
  pick: CanonicalPick,
  now = new Date().toISOString(),
): DomainAnalysis | null {
  if (pick.odds === undefined || pick.odds === null) {
    return null;
  }

  const americanOdds = pick.odds;

  const impliedProbability = americanToImplied(americanOdds);
  const decimalOdds = americanToDecimal(americanOdds);

  // Validate: implied probability must be in (0,1) exclusive
  if (impliedProbability <= 0 || impliedProbability >= 1) {
    return null;
  }

  // Validate: decimal odds must be > 1 for Kelly sizing
  if (decimalOdds <= 1) {
    return null;
  }

  const analysis: DomainAnalysis = {
    impliedProbability,
    decimalOdds: roundTo(decimalOdds, 6),
    version: DOMAIN_ANALYSIS_VERSION,
    computedAt: now,
  };

  // If confidence is present (0-1 range), compute edge and Kelly
  if (
    pick.confidence !== undefined &&
    pick.confidence !== null &&
    pick.confidence > 0 &&
    pick.confidence < 1
  ) {
    const edge = roundTo(pick.confidence - impliedProbability, 6);
    analysis.edge = edge;           // backward compat — existing DB records use this name
    analysis.confidenceDelta = edge; // canonical name for new code
    analysis.hasPositiveEdge = edge > 0;

    // Kelly fraction: uses confidence as win probability estimate
    const kellyFraction = computeKellyFraction(pick.confidence, decimalOdds);
    if (kellyFraction > 0) {
      analysis.kellyFraction = kellyFraction;
    }
  }

  return analysis;
}

/**
 * Enrich a pick's metadata with domain analysis.
 * Returns a new metadata object (does not mutate the original).
 */
export function enrichMetadataWithDomainAnalysis(
  metadata: Record<string, unknown>,
  analysis: DomainAnalysis | null,
): Record<string, unknown> {
  if (analysis === null) {
    return metadata;
  }

  return {
    ...metadata,
    domainAnalysis: analysis,
  };
}
