/**
 * VERIFICATION & SIMULATION CONTROL PLANE — Replay Divergence Engine
 * UTV2-1092: INIT-1.2.3 — Replay Divergence Engine
 *
 * Compares replay output to historical production output at the field level.
 * Divergence is zero-tolerance: any difference halts the replay run and
 * emits a ReplayDivergenceReport routed to the Governance Reviewer.
 *
 * Design laws:
 *   - A divergence is NEVER suppressed or downgraded to advisory.
 *   - The engine emits a 'divergence' event before throwing.
 *   - Callers subscribe to 'divergence' to route to the Governance Reviewer.
 *   - Field comparison is strict: type mismatches, extra fields, missing fields,
 *     and value differences are all classified as divergence.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { PipelineStage, ReplayDivergenceReport } from './replay-types.js';

// ─────────────────────────────────────────────────────────────
// COMPARE UTILITY
// ─────────────────────────────────────────────────────────────

interface FieldDiff {
  field: string;
  expected_value: unknown;
  actual_value: unknown;
}

/**
 * Deep field-level comparison between expected and actual records.
 *
 * Strategy:
 *   1. Fast path: JSON.stringify equality (handles most non-divergent cases)
 *   2. Field-level diff: enumerate all fields from both records
 *   3. Value comparison: JSON.stringify per value to handle nested objects
 *
 * Zero-tolerance: any difference — missing field, extra field, changed value,
 * type mismatch — is recorded as a diff.
 */
function computeFieldDiffs(
  expected: Readonly<Record<string, unknown>>,
  actual: Readonly<Record<string, unknown>>
): FieldDiff[] {
  // Fast path: identical serialization → no diffs
  if (JSON.stringify(expected) === JSON.stringify(actual)) {
    return [];
  }

  const diffs: FieldDiff[] = [];
  const allFields = new Set([...Object.keys(expected), ...Object.keys(actual)]);

  for (const field of allFields) {
    const expectedVal = expected[field];
    const actualVal = actual[field];

    // Deep comparison via JSON serialization — handles nested objects and arrays
    if (JSON.stringify(expectedVal) !== JSON.stringify(actualVal)) {
      diffs.push({ field, expected_value: expectedVal, actual_value: actualVal });
    }
  }

  return diffs;
}

// ─────────────────────────────────────────────────────────────
// ENGINE
// ─────────────────────────────────────────────────────────────

export interface ReplayDivergenceEngineOptions {
  /** ID of the replay run being validated. Required for report attribution. */
  runId: string;
}

/**
 * Detects and escalates divergences between replay output and historical
 * production output.
 *
 * Usage:
 *   const engine = new ReplayDivergenceEngine({ runId: 'replay-123' });
 *   engine.on('divergence', (report) => governanceRouter.escalate(report));
 *   engine.compare('ingestion', 'pick-abc', historicalOutput, replayOutput);
 *   // Throws if divergence detected; 'divergence' event fires first.
 *
 * All emitted reports are also accessible via engine.getReports() for the
 * proof bundle.
 */
export class ReplayDivergenceEngine extends EventEmitter {
  private readonly runId: string;
  private readonly reports: ReplayDivergenceReport[] = [];

  constructor(options: ReplayDivergenceEngineOptions) {
    super();
    this.runId = options.runId;
  }

  /**
   * Compare the replay output for a single item against its expected
   * historical production output.
   *
   * If any field-level divergence is detected:
   *   1. A ReplayDivergenceReport is constructed and appended to this.reports
   *   2. The 'divergence' event is emitted with the report
   *   3. An error is thrown — replay halts
   *
   * If outputs are identical: returns without side effects.
   *
   * @param stage - Pipeline stage this comparison belongs to
   * @param itemId - Unique identifier for the item (e.g., pick_id)
   * @param expected - Historical production output (immutable reference)
   * @param actual - Replay run output
   * @throws When any divergence is detected
   */
  compare(
    stage: PipelineStage,
    itemId: string,
    expected: Readonly<Record<string, unknown>>,
    actual: Readonly<Record<string, unknown>>
  ): void {
    const fieldDiffs = computeFieldDiffs(expected, actual);

    if (fieldDiffs.length === 0) {
      return;
    }

    const diffSummary = fieldDiffs
      .map(d => `${d.field}: expected ${JSON.stringify(d.expected_value)}, got ${JSON.stringify(d.actual_value)}`)
      .join('; ');

    const report: ReplayDivergenceReport = {
      report_id: randomUUID(),
      run_id: this.runId,
      detected_at: new Date().toISOString(),
      stage,
      item_id: itemId,
      expected,
      actual,
      field_diffs: fieldDiffs,
      description: `Divergence in ${stage}/${itemId}: ${diffSummary}`,
      severity: 'critical',
    };

    this.reports.push(report);
    this.emit('divergence', report);

    throw new Error(
      `Replay divergence detected in stage '${stage}', item '${itemId}': ${diffSummary}`
    );
  }

  /**
   * All divergence reports collected during this run (immutable).
   * Populated before each throw — callers may read even after catch.
   */
  getReports(): ReadonlyArray<ReplayDivergenceReport> {
    return this.reports;
  }

  /**
   * Whether any divergence was detected during this run.
   */
  hasDivergence(): boolean {
    return this.reports.length > 0;
  }
}
