/**
 * VERIFICATION & SIMULATION CONTROL PLANE — ShadowVerdictEngine
 * Sprint: SPRINT-VERIFICATION-SHADOW-DIVERGENCE-GUARDRAILS
 *
 * Determines PASS / PASS_WITH_WARNINGS / FAIL verdict from
 * a ClassifiedDivergences summary.
 *
 * Rules:
 *   Any CRITICAL present    → FAIL + freezeRecommended=true
 *   Any HIGH (no CRITICAL)  → PASS_WITH_WARNINGS
 *   MEDIUM or LOW only      → PASS_WITH_WARNINGS
 *   No divergences          → PASS
 */

import type { ClassifiedDivergences, ShadowVerdict, ShadowVerdictResult } from './types.js';

// ─────────────────────────────────────────────────────────────
// VERDICT ENGINE
// ─────────────────────────────────────────────────────────────

export class ShadowVerdictEngine {
  /**
   * Determine verdict and freeze recommendation from classified divergences.
   */
  static determine(divergences: ClassifiedDivergences): ShadowVerdictResult {
    const verdict = ShadowVerdictEngine.computeVerdict(divergences);
    const freezeRecommended = ShadowVerdictEngine.shouldFreeze(divergences);

    return {
      verdict,
      freezeRecommended,
      divergences,
      generatedAt: new Date().toISOString(), // WALL-CLOCK-ALLOWED: verdict metadata, non-lifecycle
    };
  }

  /**
   * Compute PASS / PASS_WITH_WARNINGS / FAIL from the bySeverity counts.
   */
  static computeVerdict(divergences: ClassifiedDivergences): ShadowVerdict {
    const { bySeverity, totalCount } = divergences;

    if (bySeverity.CRITICAL > 0) return 'FAIL';
    if (totalCount > 0) return 'PASS_WITH_WARNINGS';
    return 'PASS';
  }

  /**
   * Returns true when autopilot freeze is recommended.
   * Freeze is triggered by any CRITICAL-level divergence.
   */
  static shouldFreeze(divergences: ClassifiedDivergences): boolean {
    return divergences.bySeverity.CRITICAL > 0;
  }
}
