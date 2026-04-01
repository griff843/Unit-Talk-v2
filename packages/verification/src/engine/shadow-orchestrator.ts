/**
 * VERIFICATION & SIMULATION CONTROL PLANE — ShadowOrchestrator
 * Sprint: SPRINT-VERIFICATION-SIMULATION-LAYER-R3
 *
 * Runs both reference and shadow pipelines against their respective event stores,
 * calls ShadowComparator to detect divergences, and assembles a ShadowResult.
 *
 * Design law:
 *   - Uses RunController to validate mode/clock/adapter compatibility
 *   - Both lanes use ShadowPipelineRunner (same validators, same business logic)
 *   - No `if (mode === 'shadow')` in dispatch logic — mode is handled by adapters
 *   - All writes go to IsolatedPickStore (never production Supabase)
 *   - wall-clock used only for run metadata (startedAt/completedAt)
 */

import { RunController } from './run-controller.js';
import { ShadowComparator } from './shadow-comparator.js';
import { ShadowPipelineRunner } from './shadow-pipeline-runner.js';

import type { AdapterManifest } from './adapters.js';
import type { RecordedPublish } from './adapters/recording-publish.js';
import type { ClockProvider } from './clock.js';
import type { JournalEventStore } from './event-store.js';
import type { LifecycleTrace } from './replay-lifecycle-runner.js';
import type { RunManifest } from './run-controller.js';
import type { DivergenceReport } from './shadow-comparator.js';
import type { ShadowError } from './shadow-pipeline-runner.js';

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export interface ShadowRunConfig {
  runId: string;
  referenceStore: JournalEventStore;
  shadowStore: JournalEventStore;
  /** ClockProvider — RealClockProvider for production shadow; virtual for testing. */
  clock: ClockProvider;
  /** Reference adapters (production-equivalent event set). */
  referenceAdapters: AdapterManifest;
  /** Shadow adapters (potentially different model outputs). */
  shadowAdapters: AdapterManifest;
  /** Optional date range for event filtering. */
  from?: Date;
  to?: Date;
}

export interface ShadowResult {
  runId: string;
  mode: 'shadow';
  startedAt: string; // WALL-CLOCK-ALLOWED: run metadata, non-lifecycle
  completedAt: string; // WALL-CLOCK-ALLOWED: run metadata, non-lifecycle
  durationMs: number;
  referenceEventsProcessed: number;
  shadowEventsProcessed: number;
  referencePicksCreated: number;
  shadowPicksCreated: number;
  referenceErrors: ShadowError[];
  shadowErrors: ShadowError[];
  referenceTrace: ReadonlyArray<LifecycleTrace>;
  shadowTrace: ReadonlyArray<LifecycleTrace>;
  referencePublishes: ReadonlyArray<RecordedPublish>;
  shadowPublishes: ReadonlyArray<RecordedPublish>;
  divergenceReport: DivergenceReport;
  runManifest: RunManifest;
}

// ─────────────────────────────────────────────────────────────
// ORCHESTRATOR
// ─────────────────────────────────────────────────────────────

export class ShadowOrchestrator {
  private readonly config: ShadowRunConfig;
  private readonly controller: RunController;
  private readonly referencePipeline: ShadowPipelineRunner;
  private readonly shadowPipeline: ShadowPipelineRunner;

  constructor(config: ShadowRunConfig) {
    this.config = config;

    // RunController validates mode + clock + adapter compatibility for the reference lane
    this.controller = new RunController({
      runId: config.runId,
      mode: 'shadow',
      clock: config.clock,
      adapters: config.referenceAdapters,
    });

    this.referencePipeline = new ShadowPipelineRunner(config.referenceAdapters);
    this.shadowPipeline = new ShadowPipelineRunner(config.shadowAdapters);
  }

  /**
   * Execute both reference and shadow passes, compare outputs, return full result.
   */
  async run(): Promise<ShadowResult> {
    const startedAt = new Date().toISOString(); // WALL-CLOCK-ALLOWED: run metadata
    const startMs = Date.now(); // WALL-CLOCK-ALLOWED: run metadata

    // Run reference pipeline
    const referenceResult = await this.referencePipeline.run(
      this.config.referenceStore,
      this.config.clock,
      `${this.config.runId}-ref`,
      this.config.from,
      this.config.to
    );

    // Run shadow pipeline
    const shadowResult = await this.shadowPipeline.run(
      this.config.shadowStore,
      this.config.clock,
      `${this.config.runId}-shadow`,
      this.config.from,
      this.config.to
    );

    // Compare outputs
    const divergenceReport = ShadowComparator.compare(
      referenceResult,
      shadowResult,
      this.config.runId
    );

    const completedAt = new Date().toISOString(); // WALL-CLOCK-ALLOWED: run metadata
    const durationMs = Date.now() - startMs; // WALL-CLOCK-ALLOWED: run metadata

    return {
      runId: this.config.runId,
      mode: 'shadow',
      startedAt,
      completedAt,
      durationMs,
      referenceEventsProcessed: referenceResult.eventsProcessed,
      shadowEventsProcessed: shadowResult.eventsProcessed,
      referencePicksCreated: referenceResult.picksCreated,
      shadowPicksCreated: shadowResult.picksCreated,
      referenceErrors: referenceResult.errors,
      shadowErrors: shadowResult.errors,
      referenceTrace: referenceResult.trace,
      shadowTrace: shadowResult.trace,
      referencePublishes: referenceResult.publishRecords,
      shadowPublishes: shadowResult.publishRecords,
      divergenceReport,
      runManifest: this.controller.getManifest(),
    };
  }
}
