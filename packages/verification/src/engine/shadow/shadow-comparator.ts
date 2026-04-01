/**
 * VERIFICATION & SIMULATION CONTROL PLANE — Shadow Score Comparator
 * Sprint: SPRINT-VERIFICATION-SHADOW-DIVERGENCE-GUARDRAILS
 *
 * Score-based comparison of reference vs shadow pick states.
 * Computes absoluteDiff + percentDiff for numeric score fields.
 *
 * DISTINCT from the flat R3 ShadowComparator (apps/api/src/lib/verification/shadow-comparator.ts)
 * which performs structural field-equality comparison.
 *
 * Score fields compared:
 *   professional_score, grade_score, confidence,
 *   meta.grade_score, meta.confidence
 *
 * Thresholds:
 *   percentDiff > 0.05             → HIGH   (>5%)
 *   0.01 < percentDiff ≤ 0.05     → MEDIUM (<5%)
 *   percentDiff ≤ 0.01            → LOW    (<1%)
 */

import type { ScoreDivergence, DivergenceLevel } from './types.js';

// Score fields checked at the top level of a pick state record
const TOP_LEVEL_SCORE_FIELDS = ['professional_score', 'grade_score', 'confidence'] as const;

// Score fields checked within the nested `meta` object
const META_SCORE_FIELDS = ['grade_score', 'confidence'] as const;

// ─────────────────────────────────────────────────────────────
// COMPARATOR
// ─────────────────────────────────────────────────────────────

export class ShadowScoreComparator {
  /**
   * Compare reference and shadow pick states for numeric score divergences.
   * Returns one ScoreDivergence entry per field that differs meaningfully.
   */
  static compare(
    referencePickState: Map<string, Record<string, unknown>>,
    shadowPickState: Map<string, Record<string, unknown>>
  ): ScoreDivergence[] {
    const divergences: ScoreDivergence[] = [];

    // Only compare picks present in both lanes — structural missing-pick
    // divergences are handled by the R3 ShadowComparator / DivergenceClassifier
    for (const [pickId, refPick] of referencePickState) {
      const shadowPick = shadowPickState.get(pickId);
      if (!shadowPick) continue;

      // Top-level score fields
      for (const field of TOP_LEVEL_SCORE_FIELDS) {
        const refVal = refPick[field];
        const shadowVal = shadowPick[field];
        if (typeof refVal !== 'number' || typeof shadowVal !== 'number') continue;

        const entry = ShadowScoreComparator.buildEntry(pickId, field, refVal, shadowVal);
        if (entry) divergences.push(entry);
      }

      // Nested meta fields
      const refMeta = refPick['meta'] as Record<string, unknown> | undefined;
      const shadowMeta = shadowPick['meta'] as Record<string, unknown> | undefined;

      if (refMeta && shadowMeta) {
        for (const field of META_SCORE_FIELDS) {
          const refVal = refMeta[field];
          const shadowVal = shadowMeta[field];
          if (typeof refVal !== 'number' || typeof shadowVal !== 'number') continue;

          const entry = ShadowScoreComparator.buildEntry(
            pickId,
            `meta.${field}`,
            refVal,
            shadowVal
          );
          if (entry) divergences.push(entry);
        }
      }
    }

    return divergences;
  }

  /**
   * Build a ScoreDivergence entry for a numeric field.
   * Returns null if the values are identical (no divergence to report).
   */
  static buildEntry(
    pickId: string,
    field: string,
    refVal: number,
    shadowVal: number
  ): ScoreDivergence | null {
    if (refVal === shadowVal) return null;

    const absoluteDiff = Math.abs(refVal - shadowVal);
    const percentDiff = refVal !== 0 ? absoluteDiff / Math.abs(refVal) : 1;

    const level = ShadowScoreComparator.classifyPercent(percentDiff);

    return {
      pickId,
      field,
      referenceScore: refVal,
      shadowScore: shadowVal,
      absoluteDiff,
      percentDiff,
      level,
    };
  }

  /**
   * Classify a percent diff (0-1 range) into a DivergenceLevel.
   */
  static classifyPercent(percentDiff: number): DivergenceLevel {
    if (percentDiff > 0.05) return 'HIGH';
    if (percentDiff > 0.01) return 'MEDIUM';
    return 'LOW';
  }
}
