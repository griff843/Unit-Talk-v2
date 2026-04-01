/**
 * VERIFICATION & SIMULATION CONTROL PLANE — ShadowPipelineRunner
 * Sprint: SPRINT-VERIFICATION-SIMULATION-LAYER-R3
 *
 * Thin facade over ReplayLifecycleRunner + IsolatedPickStore.
 * Executes a full event stream dispatch pass and collects structured results.
 *
 * Design law — ONE PIPELINE, MULTIPLE MODES:
 *   Calls the SAME pure validation functions and dispatch table as
 *   ReplayOrchestrator. The only difference is the input event store
 *   and adapter set — provided externally by ShadowOrchestrator.
 *
 *   There are NO `if (mode === 'shadow')` branches in this file.
 */

import { RecordingPublishAdapter } from './adapters/recording-publish.js';
import { IsolatedPickStore } from './isolated-pick-store.js';
import { ReplayLifecycleRunner } from './replay-lifecycle-runner.js';

import type { AdapterManifest } from './adapters.js';
import type { RecordedPublish } from './adapters/recording-publish.js';
import type { ClockProvider } from './clock.js';
import type { JournalEventStore, ReplayEvent } from './event-store.js';
import type { LifecycleTrace } from './replay-lifecycle-runner.js';
import type { LifecyclePick } from './v2-type-bridge.js';

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export interface ShadowError {
  eventId: string;
  eventType: string;
  pickId?: string | undefined;
  error: string;
  sequenceNumber: number;
}

export interface ShadowPipelineResult {
  eventsProcessed: number;
  eventsSkipped: number;
  picksCreated: number;
  errors: ShadowError[];
  trace: ReadonlyArray<LifecycleTrace>;
  /** Final pick state snapshot (pickId → pick record). */
  finalPickState: Map<string, Record<string, unknown>>;
  /** All publish calls recorded by RecordingPublishAdapter. */
  publishRecords: ReadonlyArray<RecordedPublish>;
  /** Raw events processed in this pass. */
  events: ReadonlyArray<ReplayEvent>;
}

// ─────────────────────────────────────────────────────────────
// PIPELINE RUNNER
// ─────────────────────────────────────────────────────────────

/**
 * Executes a single event-stream pass using lifecycle validators and
 * isolated storage. Used by ShadowOrchestrator for both reference and
 * shadow lanes.
 */
export class ShadowPipelineRunner {
  private readonly adapters: AdapterManifest;
  private readonly pickStore: IsolatedPickStore;
  private readonly lifecycleRunner: ReplayLifecycleRunner;
  private readonly errors: ShadowError[] = [];

  constructor(adapters: AdapterManifest) {
    this.adapters = adapters;
    this.pickStore = new IsolatedPickStore();
    this.lifecycleRunner = new ReplayLifecycleRunner(this.pickStore);
  }

  /**
   * Execute one full pass through the event store.
   * Returns structured results for comparison by ShadowComparator.
   */
  async run(
    store: JournalEventStore,
    clock: ClockProvider,
    runId: string,
    from?: Date | undefined,
    to?: Date | undefined
  ): Promise<ShadowPipelineResult> {
    // Reset all state before this pass
    this.pickStore.clear();
    this.lifecycleRunner.clearTrace();
    this.errors.length = 0;

    const allEvents = from && to ? store.getEventsBetween(from, to) : store.getAllEvents();

    let eventsProcessed = 0;
    let eventsSkipped = 0;

    for (const event of allEvents) {
      let processed = false;
      try {
        processed = await this.dispatch(event, clock, runId);
      } catch (err) {
        this.errors.push({
          eventId: event.eventId,
          eventType: event.eventType,
          pickId: event.pickId,
          error: err instanceof Error ? err.message : String(err),
          sequenceNumber: event.sequenceNumber,
        });
      }

      if (processed) eventsProcessed++;
      else eventsSkipped++;
    }

    const trace = this.lifecycleRunner.getTrace();
    const finalPickState = this.pickStore.getSnapshot();
    // Cast is safe: ShadowOrchestrator always wires RecordingPublishAdapter for shadow mode
    const publishAdapter = this.adapters.publish as unknown as RecordingPublishAdapter;
    const publishRecords = publishAdapter.getRecords();

    return {
      eventsProcessed,
      eventsSkipped,
      picksCreated: this.pickStore.size,
      errors: [...this.errors],
      trace,
      finalPickState,
      publishRecords,
      events: allEvents,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // DISPATCH — identical table to ReplayOrchestrator.dispatch()
  // No `if (mode === 'shadow')` branches — same validators, same order
  // ─────────────────────────────────────────────────────────────

  private async dispatch(
    event: ReplayEvent,
    clock: ClockProvider,
    runId: string
  ): Promise<boolean> {
    switch (event.eventType) {
      case 'PICK_SUBMITTED': {
        const pick = (event.payload['pick'] ?? {}) as Partial<LifecyclePick> & { id: string };
        const result = this.lifecycleRunner.insert(pick, {
          writerRole: 'submitter',
          traceId: `shadow-${runId}-${event.eventId}`,
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
          traceId: `shadow-${runId}-${event.eventId}`,
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

        const claimResult = this.lifecycleRunner.claimForPosting(event.pickId, {
          writerRole: 'poster',
          traceId: `shadow-${runId}-${event.eventId}`,
          clock,
        });

        if (claimResult.success) {
          const posting = (event.payload['posting'] ?? {}) as Record<string, unknown>;
          await this.adapters.publish.publish(event.pickId, posting);
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

        const settlementData = await this.adapters.settlement.checkSettlement(event.pickId, clock);

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
            traceId: `shadow-${runId}-${event.eventId}`,
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
        await this.adapters.recap.generate(period, clock);
        return true;
      }

      default:
        return false; // Unknown event type — skip
    }
  }
}
