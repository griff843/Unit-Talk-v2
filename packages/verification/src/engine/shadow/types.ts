/**
 * VERIFICATION & SIMULATION CONTROL PLANE — Shadow Guardrails Types
 * Sprint: SPRINT-VERIFICATION-SHADOW-DIVERGENCE-GUARDRAILS
 *
 * Type definitions for the score-based shadow divergence guardrail layer.
 * Distinct from the flat R3 ShadowComparator (field equality).
 *
 * Classification levels:
 *   CRITICAL — structural state mismatch (settlement, promotion, posting)
 *   HIGH     — score diff > 5%
 *   MEDIUM   — score diff ≤ 5% (> 1%)
 *   LOW      — score diff ≤ 1% (rounding)
 *
 * Verdict:
 *   FAIL               — any CRITICAL divergence present
 *   PASS_WITH_WARNINGS — HIGH / MEDIUM / LOW only
 *   PASS               — no divergences
 */

import type { AdapterManifest, NotificationAdapter } from '../adapters.js';
import type { ClockProvider } from '../clock.js';
import type { JournalEventStore } from '../event-store.js';
import type { LifecycleTrace } from '../replay-lifecycle-runner.js';
import type { DivergenceReport } from '../shadow-comparator.js';

// ─────────────────────────────────────────────────────────────
// DIVERGENCE LEVELS & VERDICT
// ─────────────────────────────────────────────────────────────

export type DivergenceLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type ShadowVerdict = 'PASS' | 'PASS_WITH_WARNINGS' | 'FAIL';

// ─────────────────────────────────────────────────────────────
// SCORE DIVERGENCE — percentage-based numeric comparison
// ─────────────────────────────────────────────────────────────

export interface ScoreDivergence {
  pickId: string;
  field: string;
  referenceScore: number;
  shadowScore: number;
  /** Absolute |ref - shadow| */
  absoluteDiff: number;
  /** Fraction of reference value: |ref - shadow| / ref  (0-1 range; 0.07 = 7%) */
  percentDiff: number;
  level: DivergenceLevel;
}

// ─────────────────────────────────────────────────────────────
// STRUCTURAL DIVERGENCE — always CRITICAL
// ─────────────────────────────────────────────────────────────

export interface StructuralDivergence {
  pickId?: string | undefined;
  category: string;
  field?: string | undefined;
  referenceValue: unknown;
  shadowValue: unknown;
  level: 'CRITICAL';
  description: string;
}

// ─────────────────────────────────────────────────────────────
// CLASSIFIED DIVERGENCES — combined summary
// ─────────────────────────────────────────────────────────────

export interface ClassifiedDivergences {
  scoreDivergences: ScoreDivergence[];
  structuralDivergences: StructuralDivergence[];
  bySeverity: {
    CRITICAL: number;
    HIGH: number;
    MEDIUM: number;
    LOW: number;
  };
  totalCount: number;
}

// ─────────────────────────────────────────────────────────────
// SHADOW VERDICT RESULT
// ─────────────────────────────────────────────────────────────

export interface ShadowVerdictResult {
  verdict: ShadowVerdict;
  freezeRecommended: boolean;
  divergences: ClassifiedDivergences;
  generatedAt: string; // WALL-CLOCK-ALLOWED: verdict metadata, non-lifecycle
}

// ─────────────────────────────────────────────────────────────
// SHADOW RUNNER CONFIG & RESULT
// ─────────────────────────────────────────────────────────────

export interface ShadowRunnerConfig {
  runId: string;
  referenceStore: JournalEventStore;
  shadowStore: JournalEventStore;
  clock: ClockProvider;
  referenceAdapters: AdapterManifest;
  shadowAdapters: AdapterManifest;
  /** Receives a critical-severity alert when freezeRecommended=true. */
  notificationAdapter: NotificationAdapter;
  /** Repo root for proof bundle output path resolution. Defaults to cwd. */
  repoRoot?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}

export interface ShadowRunnerResult {
  runId: string;
  verdictResult: ShadowVerdictResult;
  /** R3 structural divergence report (field equality). */
  divergenceReport: DivergenceReport;
  shadowTrace: ReadonlyArray<LifecycleTrace>;
  referenceTrace: ReadonlyArray<LifecycleTrace>;
  proofBundlePath: string;
  durationMs: number;
  startedAt: string; // WALL-CLOCK-ALLOWED: run metadata, non-lifecycle
  completedAt: string; // WALL-CLOCK-ALLOWED: run metadata, non-lifecycle
}
