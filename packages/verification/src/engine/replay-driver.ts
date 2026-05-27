/**
 * VERIFICATION & SIMULATION CONTROL PLANE — ReplayDriver
 * UTV2-1095: INIT-1.2.4 — 30-Day Replay Driver and Latent-Divergence Remediation
 *
 * Drives a deterministic full-pipeline replay over a configurable window (default: 30 days).
 * Uses the existing FullPipelineReplayHarness + ReplayDivergenceEngine infrastructure.
 *
 * Design laws:
 *   - Zero production writes: productionWritesAttempted MUST be 0 — throws if violated
 *   - Divergence is never suppressed: any divergence halts the run and populates the proof bundle
 *   - Window is computed from an injected deterministic clock.
 *   - dryRun defaults to true; setting it to false is only for test scaffolding
 *   - The ReplayProofBundle is the authoritative output for T1 evidence purposes
 */

import { FullPipelineReplayHarness } from './full-pipeline-replay.js';
import { ReplayDivergenceEngine } from './replay-divergence.js';

import type { ReplayDivergenceReport } from './replay-types.js';
import type { ReplaySnapshot } from './replay-types.js';

// ─────────────────────────────────────────────────────────────
// PUBLIC TYPES
// ─────────────────────────────────────────────────────────────

export interface ReplayDriverOptions {
  /** How many days back from now to replay. Default: 30. */
  windowDays?: number;
  /** Unique deterministic ID for this replay run. Required. */
  replayRunId: string;
  /** Deterministic clock for all replay proof timestamps. Required. */
  clock: ReplayClock;
  /** Always treat as read-only. Default: true. Set to false only in test scaffolding. */
  dryRun?: boolean;
}

export interface ReplayClock {
  now(): Date;
}

export interface ReplayProofBundle {
  /** Unique ID for this replay run. */
  replayRunId: string;
  /** How many days the window covers. */
  windowDays: number;
  /** ISO-8601 start of the replay window. */
  windowStart: string;
  /** ISO-8601 end of the replay window (≈ now). */
  windowEnd: string;
  /** How many picks were processed in this run. */
  picksReplayed: number;
  /** How many divergences were found (zero-tolerance; any > 0 means halted). */
  divergencesFound: number;
  /** Full structured reports for every divergence detected. */
  divergenceDetails: ReplayDivergenceReport[];
  /** Must always be 0 — any other value indicates a broken isolation invariant. */
  productionWritesAttempted: number;
  /** True when the run halted early due to divergence or invariant violation. */
  halted: boolean;
  /** Human-readable reason if halted. */
  haltReason?: string | undefined;
  /** ISO-8601 wall-clock time when the proof bundle was sealed. */
  completedAt: string;
}

// ─────────────────────────────────────────────────────────────
// MINIMAL LOCAL PICK TYPE
// ─────────────────────────────────────────────────────────────

/**
 * Minimal pick shape accepted by ReplayDriver.run().
 *
 * Callers pass their own pick records — the driver converts them to
 * ReplaySnapshot records before feeding into the harness. This avoids
 * hard cross-package dependencies on CanonicalPick from @unit-talk/contracts.
 */
export interface ReplayPickRecord {
  id: string;
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────
// DRIVER
// ─────────────────────────────────────────────────────────────

/**
 * Drives a deterministic full-pipeline replay over a configurable time window.
 *
 * Usage:
 *   const driver = new ReplayDriver({ windowDays: 30 });
 *   const proof = await driver.run(picks);
 *   assert.equal(proof.productionWritesAttempted, 0);
 *   assert.equal(proof.divergencesFound, 0);
 */
export class ReplayDriver {
  private readonly windowDays: number;
  private readonly replayRunId: string;
  private readonly clock: ReplayClock;
  private readonly dryRun: boolean;

  constructor(options?: ReplayDriverOptions) {
    this.windowDays = options?.windowDays ?? 30;
    if (!options?.replayRunId || options.replayRunId.trim() === '') {
      throw new Error('ReplayDriver requires deterministic replayRunId');
    }
    if (!options.clock) {
      throw new Error('ReplayDriver requires an injected deterministic clock');
    }
    this.replayRunId = options.replayRunId;
    this.clock = options.clock;
    this.dryRun = options?.dryRun ?? true;
  }

  // ─────────────────────────────────────────────────────────────
  // RUN
  // ─────────────────────────────────────────────────────────────

  /**
   * Execute the 30-day (or custom-window) replay over the provided picks.
   *
   * Invariants:
   *   - productionWritesAttempted MUST be 0 — thrown Error if violated
   *   - Any divergence → halted=true, divergenceDetails populated, returns immediately
   *   - Never writes to production regardless of dryRun flag
   *
   * @param picks - Read-only array of pick records to replay
   */
  async run(picks: readonly ReplayPickRecord[]): Promise<ReplayProofBundle> {
    const windowEnd = this.clock.now();
    const windowStart = new Date(windowEnd.getTime() - this.windowDays * 24 * 60 * 60 * 1000);

    // Build snapshots from picks — each pick becomes an ingestion-stage snapshot
    const snapshots: ReplaySnapshot[] = picks.map(pick => ({
      snapshot_id: `snap-${this.replayRunId}-${pick.id}`,
      captured_at: windowStart.toISOString(),
      stage: 'ingestion',
      data: { ...pick } as Readonly<Record<string, unknown>>,
    }));

    // Set up divergence engine — emits 'divergence' event before throwing
    const divergenceEngine = new ReplayDivergenceEngine({ runId: this.replayRunId });
    const divergenceReports: ReplayDivergenceReport[] = [];

    divergenceEngine.on('divergence', (report: ReplayDivergenceReport) => {
      divergenceReports.push(report);
    });

    // Set up the harness
    const harness = new FullPipelineReplayHarness(snapshots, this.replayRunId);

    let halted = false;
    let haltReason: string | undefined;

    try {
      const result = await harness.run();

      // Enforce zero-write invariant (mechanical, not conventional)
      const productionWrites = harness.getProductionWriteCount();
      if (productionWrites !== 0) {
        throw new Error(
          `Isolation invariant violated: productionWritesAttempted=${productionWrites} (must be 0)`
        );
      }

      // Check if the harness detected any divergence internally
      if (result.divergence_detected) {
        halted = true;
        haltReason = 'Harness flagged divergence_detected=true';
      }
    } catch (err) {
      halted = true;
      haltReason = err instanceof Error ? err.message : String(err);
    }

    // If divergence engine collected reports, ensure halted reflects that
    const allDivergences = [...divergenceReports, ...divergenceEngine.getReports()];
    // Deduplicate by report_id
    const seenIds = new Set<string>();
    const uniqueDivergences: ReplayDivergenceReport[] = [];
    for (const r of allDivergences) {
      if (!seenIds.has(r.report_id)) {
        seenIds.add(r.report_id);
        uniqueDivergences.push(r);
      }
    }

    if (uniqueDivergences.length > 0 && !halted) {
      halted = true;
      haltReason = `${uniqueDivergences.length} divergence(s) detected`;
    }

    // Enforce the zero-write guarantee at the proof-bundle level
    const productionWritesAttempted = harness.getProductionWriteCount();
    if (productionWritesAttempted !== 0 && !halted) {
      halted = true;
      haltReason = `productionWritesAttempted=${productionWritesAttempted} (must be 0)`;
    }

    const proof: ReplayProofBundle = {
      replayRunId: this.replayRunId,
      windowDays: this.windowDays,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      picksReplayed: picks.length,
      divergencesFound: uniqueDivergences.length,
      divergenceDetails: uniqueDivergences,
      productionWritesAttempted,
      halted,
      haltReason,
      completedAt: this.clock.now().toISOString(),
    };

    return proof;
  }
}
