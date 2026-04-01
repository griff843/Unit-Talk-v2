/**
 * VERIFICATION & SIMULATION CONTROL PLANE — DivergenceClassifier
 * Sprint: SPRINT-VERIFICATION-SHADOW-DIVERGENCE-GUARDRAILS
 *
 * Classifies R3 structural divergences + score divergences into a
 * unified ClassifiedDivergences summary.
 *
 * Structural rules (always CRITICAL):
 *   settlement_result, settlement_status  → CRITICAL
 *   promotion_status mismatch             → CRITICAL
 *   posted_to_discord mismatch            → CRITICAL
 *   Missing pick (present in one lane only) → CRITICAL
 *
 * Score rules (percentage-based, from ShadowScoreComparator):
 *   percentDiff > 0.05   → HIGH
 *   percentDiff ≤ 0.05   → MEDIUM
 *   percentDiff ≤ 0.01   → LOW
 */

import { ShadowScoreComparator } from './shadow-comparator.js';

import type { DivergenceReport, DivergenceEntry } from '../shadow-comparator.js';
import type { ClassifiedDivergences, StructuralDivergence } from './types.js';

// Structural fields from the R3 divergence report that escalate to CRITICAL
const CRITICAL_STRUCTURAL_FIELDS = new Set([
  'settlement_result',
  'settlement_status',
  'promotion_status',
  'posted_to_discord',
]);

// ─────────────────────────────────────────────────────────────
// CLASSIFIER
// ─────────────────────────────────────────────────────────────

export class DivergenceClassifier {
  /**
   * Classify divergences from both the R3 structural report and
   * score-based comparison into a unified ClassifiedDivergences object.
   *
   * @param r3Report       - Output of R3 ShadowComparator.compare()
   * @param referenceState - Final pick state from reference pipeline
   * @param shadowState    - Final pick state from shadow pipeline
   */
  static classify(
    r3Report: DivergenceReport,
    referenceState: Map<string, Record<string, unknown>>,
    shadowState: Map<string, Record<string, unknown>>
  ): ClassifiedDivergences {
    const structuralDivergences = DivergenceClassifier.classifyStructural(r3Report.divergences);
    const scoreDivergences = ShadowScoreComparator.compare(referenceState, shadowState);

    const bySeverity = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };

    for (const sd of structuralDivergences) {
      bySeverity[sd.level]++;
    }
    for (const sc of scoreDivergences) {
      bySeverity[sc.level]++;
    }

    return {
      structuralDivergences,
      scoreDivergences,
      bySeverity,
      totalCount: structuralDivergences.length + scoreDivergences.length,
    };
  }

  /**
   * Convert R3 DivergenceEntry[] to StructuralDivergence[].
   * Entries on critical structural fields → CRITICAL.
   * All other structural entries are also mapped as CRITICAL because
   * any field mismatch that R3 detected as critical/warning carries
   * production risk in a guardrail context.
   */
  private static classifyStructural(entries: DivergenceEntry[]): StructuralDivergence[] {
    return entries
      .filter(e => DivergenceClassifier.isStructuralCritical(e))
      .map(e => ({
        pickId: e.pickId,
        category: e.category,
        field: e.field,
        referenceValue: e.referenceValue,
        shadowValue: e.shadowValue,
        level: 'CRITICAL' as const,
        description: e.description,
      }));
  }

  /**
   * Returns true when a R3 DivergenceEntry should be treated as a
   * structural CRITICAL in the guardrail layer.
   *
   * Rules:
   *   - Pick missing from one lane     → CRITICAL (production divergence)
   *   - Critical structural field diff → CRITICAL (settlement/status)
   *   - Terminal lifecycle stage diff  → CRITICAL
   *   - Publish present in one lane    → CRITICAL
   */
  private static isStructuralCritical(entry: DivergenceEntry): boolean {
    // Explicit critical-field list
    if (entry.field && CRITICAL_STRUCTURAL_FIELDS.has(entry.field)) return true;

    // Missing pick (no field, category=pick_state, critical level from R3)
    if (entry.category === 'pick_state' && entry.level === 'critical' && !entry.field) return true;

    // Terminal lifecycle stage mismatch
    if (entry.category === 'lifecycle_trace' && entry.field === 'terminal_stage') return true;

    // Pick published in only one lane
    if (entry.category === 'publish' && entry.level === 'critical' && !entry.field) return true;

    return false;
  }
}
