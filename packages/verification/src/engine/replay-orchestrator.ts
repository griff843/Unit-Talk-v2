/**
 * VERIFICATION & SIMULATION CONTROL PLANE — ReplayOrchestrator
 * Sprint: SPRINT-VERIFICATION-SIMULATION-LAYER-R2
 *
 * Orchestrates a deterministic replay run.
 *
 * Responsibilities:
 *   1. Initialize VirtualEventClock at the start of the event stream
 *   2. Poll events from ReplayFeedAdapter in sequenceNumber order
 *   3. Advance the clock to each event's timestamp before processing
 *   4. Dispatch each event to the appropriate lifecycle operation
 *   5. Collect lifecycle traces and error records
 *   6. Enforce RunController mode + adapter constraints
 *
 * Design law:
 *   - Uses RunController to validate mode/clock/adapter compatibility
 *   - All writes go to IsolatedPickStore (never production Supabase)
 *   - No `if (mode === 'replay')` branches in business dispatch logic
 *   - Clock advances deterministically — same event stream → same clock log
 */

import { ReplayFeedAdapter } from './adapters/replay-feed.js';
import { DeterminismValidator } from './determinism-validator.js';
import { IsolatedPickStore } from './isolated-pick-store.js';
import { ReplayLifecycleRunner } from './replay-lifecycle-runner.js';
import { RunController } from './run-controller.js';

import type { AdapterManifest } from './adapters.js';
import type { VirtualEventClock } from './clock.js';
import type { JournalEventStore } from './event-store.js';
import type { LifecycleTrace } from './replay-lifecycle-runner.js';
import type { LifecyclePick } from './v2-type-bridge.js';

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export interface ReplayRunConfig {
  runId: string;
  eventStore: JournalEventStore;
  /** VirtualEventClock — must be pre-initialized at event stream start. */
  clock: VirtualEventClock;
  /** Complete adapter manifest — all must be non-production mode. */
  adapters: AdapterManifest;
  /** ISO date range for event filtering (optional). */
  from?: Date;
  to?: Date;
}

export interface ReplayError {
  eventId: string;
  eventType: string;
  pickId?: string;
  error: string;
  sequenceNumber: number;
}

export interface ReplayResult {
  runId: string;
  mode: 'replay';
  startedAt: string; // WALL-CLOCK-ALLOWED: run metadata, non-lifecycle
  completedAt: string; // WALL-CLOCK-ALLOWED: run metadata, non-lifecycle
  durationMs: number;
  eventsProcessed: number;
  eventsSkipped: number;
  picksCreated: number;
  lifecycleTrace: ReadonlyArray<LifecycleTrace>;
  finalPickState: ReadonlyArray<Record<string, unknown>>;
  determinismHash: string;
  errors: ReplayError[];
  runManifest: ReturnType<RunController['getManifest']>;
  /** VirtualEventClock advancement log for proof bundle. */
  clockLog: ReturnType<VirtualEventClock['getAdvancementLog']>;
}

// ─────────────────────────────────────────────────────────────
// ORCHESTRATOR
// ─────────────────────────────────────────────────────────────

export class ReplayOrchestrator {
  private readonly config: ReplayRunConfig;
  private readonly controller: RunController;
  private readonly feedAdapter: ReplayFeedAdapter;
  private readonly pickStore: IsolatedPickStore;
  private readonly lifecycleRunner: ReplayLifecycleRunner;
  private readonly errors: ReplayError[] = [];

  constructor(config: ReplayRunConfig) {
    this.config = config;

    // RunController validates mode + clock + adapter compatibility
    this.controller = new RunController({
      runId: config.runId,
      mode: 'replay',
      clock: config.clock,
      adapters: config.adapters,
    });

    this.feedAdapter = new ReplayFeedAdapter('replay', config.eventStore);
    this.pickStore = new IsolatedPickStore();
    this.lifecycleRunner = new ReplayLifecycleRunner(this.pickStore);
  }

  // ─────────────────────────────────────────────────────────────
  // RUN
  // ─────────────────────────────────────────────────────────────

  /**
   * Execute the full replay run.
   * Returns a ReplayResult including the determinism hash for proof bundles.
   */
  async run(): Promise<ReplayResult> {
    const startedAt = new Date().toISOString(); // WALL-CLOCK-ALLOWED: run metadata
    const startMs = Date.now(); // WALL-CLOCK-ALLOWED: run metadata

    let eventsProcessed = 0;
    let eventsSkipped = 0;

    // Reset clock + store + trace for this run
    this.pickStore.clear();
    this.lifecycleRunner.clearTrace();
    this.feedAdapter.reset();
    this.errors.length = 0;

    // Filter event store to the requested range (advance clock to first event)
    const all =
      this.config.from && this.config.to
        ? this.config.eventStore.getEventsBetween(this.config.from, this.config.to)
        : this.config.eventStore.getAllEvents();

    if (all.length === 0) {
      const now = new Date().toISOString(); // WALL-CLOCK-ALLOWED: run metadata
      return this.buildResult(startedAt, now, Date.now() - startMs, 0, 0);
    }

    // Advance clock to just before first event (ensures clock.now() < first event)
    const firstEventTime = new Date(all[0]!.timestamp);
    const clockStart = new Date(firstEventTime.getTime() - 1);
    this.config.clock.advanceTo(clockStart);

    // Process events in sequenceNumber order
    for (const event of all) {
      // Advance virtual clock to this event's timestamp
      const eventTime = new Date(event.timestamp);
      this.config.clock.advanceTo(eventTime);

      let processed = false;
      try {
        processed = await this.dispatch(event);
      } catch (err) {
        this.errors.push({
          eventId: event.eventId,
          eventType: event.eventType,
          pickId: event.pickId,
          error: err instanceof Error ? err.message : String(err),
          sequenceNumber: event.sequenceNumber,
        });
      }

      if (processed) {
        eventsProcessed++;
      } else {
        eventsSkipped++;
      }
    }

    const completedAt = new Date().toISOString(); // WALL-CLOCK-ALLOWED: run metadata
    const durationMs = Date.now() - startMs; // WALL-CLOCK-ALLOWED: run metadata

    return this.buildResult(startedAt, completedAt, durationMs, eventsProcessed, eventsSkipped);
  }

  // ─────────────────────────────────────────────────────────────
  // DISPATCH — routes events to lifecycle operations
  // ─────────────────────────────────────────────────────────────

  private async dispatch(event: {
    eventId: string;
    eventType: string;
    pickId?: string;
    payload: Record<string, unknown>;
    sequenceNumber: number;
  }): Promise<boolean> {
    const clock = this.config.clock;

    switch (event.eventType) {
      case 'PICK_SUBMITTED': {
        const pick = (event.payload['pick'] ?? {}) as Partial<LifecyclePick> & { id: string };
        const result = this.lifecycleRunner.insert(pick, {
          writerRole: 'submitter',
          traceId: `replay-${this.config.runId}-${event.eventId}`,
          clock,
        });
        if (!result.success) {
          this.errors.push({
            eventId: event.eventId,
            eventType: event.eventType,
            pickId: event.pickId,
            error: result.error ?? 'insert failed',
            sequenceNumber: event.sequenceNumber,
          });
        }
        return true;
      }

      case 'PICK_GRADED': {
        if (!event.pickId) return false;
        const gradingData = (event.payload['gradingData'] ?? {}) as Record<string, unknown>;
        const result = this.lifecycleRunner.update(event.pickId, gradingData, {
          writerRole: 'promoter',
          traceId: `replay-${this.config.runId}-${event.eventId}`,
          clock,
        });
        if (!result.success) {
          this.errors.push({
            eventId: event.eventId,
            eventType: event.eventType,
            pickId: event.pickId,
            error: result.error ?? 'grade update failed',
            sequenceNumber: event.sequenceNumber,
          });
        }
        return true;
      }

      case 'PICK_POSTED': {
        if (!event.pickId) return false;

        // Claim for posting
        const claimResult = this.lifecycleRunner.claimForPosting(event.pickId, {
          writerRole: 'poster',
          traceId: `replay-${this.config.runId}-${event.eventId}`,
          clock,
        });

        if (claimResult.success) {
          // Route through RecordingPublishAdapter (no Discord)
          const posting = (event.payload['posting'] ?? {}) as Record<string, unknown>;
          await this.config.adapters.publish.publish(event.pickId, posting);
        } else if (claimResult.error !== 'Already claimed (idempotent)') {
          this.errors.push({
            eventId: event.eventId,
            eventType: event.eventType,
            pickId: event.pickId,
            error: claimResult.error ?? 'claim failed',
            sequenceNumber: event.sequenceNumber,
          });
        }
        return true;
      }

      case 'PICK_SETTLED': {
        if (!event.pickId) return false;
        const settlementData = await this.config.adapters.settlement.checkSettlement(
          event.pickId,
          clock
        );
        if (!settlementData) {
          this.errors.push({
            eventId: event.eventId,
            eventType: event.eventType,
            pickId: event.pickId,
            error: 'No settlement data found in EventStore',
            sequenceNumber: event.sequenceNumber,
          });
          return true;
        }

        const result = this.lifecycleRunner.settle(
          event.pickId,
          {
            settlement_status: settlementData.result === 'void' ? 'void' : 'settled',
            settlement_result: settlementData.result === 'void' ? undefined : settlementData.result,
            settlement_source: settlementData.source,
          },
          {
            writerRole: 'settler',
            traceId: `replay-${this.config.runId}-${event.eventId}`,
            clock,
          }
        );

        if (!result.success) {
          this.errors.push({
            eventId: event.eventId,
            eventType: event.eventType,
            pickId: event.pickId,
            error: result.error ?? 'settlement failed',
            sequenceNumber: event.sequenceNumber,
          });
        }
        return true;
      }

      case 'RECAP_TRIGGERED': {
        const period = (event.payload['period'] as 'daily' | 'weekly' | 'monthly') ?? 'daily';
        await this.config.adapters.recap.generate(period, clock);
        return true;
      }

      default:
        return false; // Unknown event type — skip
    }
  }

  // ─────────────────────────────────────────────────────────────
  // RESULT BUILDER
  // ─────────────────────────────────────────────────────────────

  private buildResult(
    startedAt: string,
    completedAt: string,
    durationMs: number,
    eventsProcessed: number,
    eventsSkipped: number
  ): ReplayResult {
    const trace = this.lifecycleRunner.getTrace();
    const finalPickState = this.pickStore.getAll();
    const snapshot = this.pickStore.getSnapshot();

    const hash = DeterminismValidator.computeHash(eventsProcessed, snapshot, [...trace]);

    return {
      runId: this.config.runId,
      mode: 'replay',
      startedAt,
      completedAt,
      durationMs,
      eventsProcessed,
      eventsSkipped,
      picksCreated: this.pickStore.size,
      lifecycleTrace: trace,
      finalPickState,
      determinismHash: hash,
      errors: [...this.errors],
      runManifest: this.controller.getManifest(),
      clockLog: this.config.clock.getAdvancementLog(),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // ACCESSORS (for testing / determinism verification)
  // ─────────────────────────────────────────────────────────────

  /** Access the isolated pick store after a run for inspection. */
  getPickStore(): IsolatedPickStore {
    return this.pickStore;
  }

  /** Access the lifecycle trace after a run. */
  getTrace(): ReadonlyArray<LifecycleTrace> {
    return this.lifecycleRunner.getTrace();
  }
}
