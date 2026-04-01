/* eslint-disable max-lines-per-function */
/**
 * VERIFICATION & SIMULATION CONTROL PLANE — FaultOrchestrator
 * Sprint: SPRINT-VERIFICATION-SIMULATION-LAYER-R4
 *
 * Orchestrates a controlled fault-injection run.
 *
 * Design law — ONE PIPELINE, MULTIPLE MODES:
 *   Uses the SAME lifecycle validation functions as production and replay.
 *   Faults are introduced ONLY through:
 *     1. Adapter wrappers (FaultPublishAdapter, FaultSettlementAdapter, etc.)
 *     2. Orchestrator-controlled triggers (staleness check, drawdown monitor)
 *   There are NO scenario-specific branches in lifecycle validation code.
 *
 * Orchestrator-controlled triggers (explicitly allowed by sprint spec):
 *   - Staleness guard: if gradingData.dataQuality === 'stale' or isStale === true,
 *     pick is blocked with 'stale-market-data' reason instead of promoted.
 *   - Quality guard: if gradingData.qualityScore < QUALITY_THRESHOLD,
 *     pick is blocked with 'degraded-quality' reason instead of promoted.
 *   - Drawdown monitor: tracks settlement_result === 'loss' outcomes;
 *     when consecutive losses >= DRAWDOWN_THRESHOLD, activates hard freeze.
 *
 * Storage: IsolatedPickStore — never writes to Supabase.
 * Mode: 'fault' — enforced by RunController.
 */

import { NullNotificationAdapter } from '../adapters/null-notification.js';
import { DeterminismValidator } from '../determinism-validator.js';
import { IsolatedPickStore } from '../isolated-pick-store.js';
import { ReplayLifecycleRunner } from '../replay-lifecycle-runner.js';
import { RunController } from '../run-controller.js';

import { FaultPublishAdapter } from './adapters/fault-publish-adapter.js';
import { FaultRecapAdapter } from './adapters/fault-recap-adapter.js';
import { FaultSettlementAdapter } from './adapters/fault-settlement-adapter.js';
import { InvariantAssertionEngine } from './assertion-engine.js';
import { FaultInjector } from './fault-injector.js';

import type { LifecyclePick } from '../v2-type-bridge.js';
import type { VirtualEventClock } from '../clock.js';
import type { JournalEventStore, ReplayEvent } from '../event-store.js';
import type { ScenarioSetup } from './scenarios/index.js';
import type { PostScenarioState, ScenarioResult, AssertorFn } from './types.js';

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

/** Staleness threshold: any marketTimestamp older than this vs. clock.now() is stale (ms). */
const STALE_AGE_MS = 5 * 60 * 1000; // 5 minutes

/** Quality score threshold: below this = degraded quality block. */
const QUALITY_THRESHOLD = 0.3;

/** Consecutive losses before drawdown freeze activates. */
const DRAWDOWN_THRESHOLD = 3;

// ─────────────────────────────────────────────────────────────
// RUN ERROR
// ─────────────────────────────────────────────────────────────

interface RunError {
  eventId: string;
  eventType: string;
  pickId?: string;
  error: string;
  sequenceNumber: number;
}

// ─────────────────────────────────────────────────────────────
// ORCHESTRATOR
// ─────────────────────────────────────────────────────────────

export class FaultOrchestrator {
  private readonly scenario: ScenarioSetup['scenario'];
  private readonly eventStore: JournalEventStore;
  private readonly clock: VirtualEventClock;
  private readonly injector: FaultInjector;
  private readonly pickStore: IsolatedPickStore;
  private readonly lifecycleRunner: ReplayLifecycleRunner;
  private readonly publishAdapter: FaultPublishAdapter;
  private readonly notificationAdapter: NullNotificationAdapter;
  private readonly settlementAdapter: FaultSettlementAdapter;
  private readonly recapAdapter: FaultRecapAdapter;

  private readonly errors: RunError[] = [];
  private consecutiveLosses = 0;
  private systemFrozen = false;
  private freezeViolationDetected = false;
  private freezeViolationMessage: string | undefined;

  constructor(setup: ScenarioSetup, clock: VirtualEventClock, runId: string) {
    this.scenario = setup.scenario;
    this.eventStore = setup.eventStore;
    this.clock = clock;
    this.injector = new FaultInjector();

    // Register all faults for this scenario
    for (const fault of setup.faults) {
      this.injector.register(fault);
    }

    // Build isolated storage and lifecycle runner
    this.pickStore = new IsolatedPickStore();
    this.lifecycleRunner = new ReplayLifecycleRunner(this.pickStore);

    // Build fault adapters
    this.publishAdapter = new FaultPublishAdapter('fault', this.injector);
    this.notificationAdapter = new NullNotificationAdapter('fault');
    this.settlementAdapter = new FaultSettlementAdapter('fault', this.eventStore, this.injector);
    this.recapAdapter = new FaultRecapAdapter('fault', this.injector);

    // Validate adapter manifest via RunController
    const adapters = {
      mode: 'fault' as const,
      publish: this.publishAdapter,
      notification: this.notificationAdapter,
      feed: { mode: 'fault' as const, poll: async () => [] }, // feed not polled in fault mode
      settlement: this.settlementAdapter,
      recap: this.recapAdapter,
    };

    new RunController({
      runId,
      mode: 'fault',
      clock,
      adapters,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // RUN
  // ─────────────────────────────────────────────────────────────

  async run(assertors: Map<string, AssertorFn>): Promise<ScenarioResult> {
    const startedAt = new Date().toISOString(); // WALL-CLOCK-ALLOWED: run metadata
    const startMs = Date.now(); // WALL-CLOCK-ALLOWED: run metadata

    // Reset state for clean run
    this.pickStore.clear();
    this.lifecycleRunner.clearTrace();
    this.errors.length = 0;
    this.consecutiveLosses = 0;
    this.systemFrozen = false;
    this.freezeViolationDetected = false;
    this.freezeViolationMessage = undefined;

    const all = this.eventStore.getAllEvents();
    if (all.length > 0) {
      const firstTime = new Date(all[0]!.timestamp);
      this.clock.advanceTo(new Date(firstTime.getTime() - 1));
    }

    // Process all events through the canonical dispatch
    for (const event of all) {
      const eventTime = new Date(event.timestamp);
      // advanceTo requires non-backward time; use advanceBy(0) if same
      if (eventTime.getTime() > this.clock.now().getTime()) {
        this.clock.advanceTo(eventTime);
      }

      try {
        await this.dispatch(event);
      } catch (err) {
        this.errors.push({
          eventId: event.eventId,
          eventType: event.eventType,
          pickId: event.pickId,
          error: err instanceof Error ? err.message : String(err),
          sequenceNumber: event.sequenceNumber,
        });
      }
    }

    const completedAt = new Date().toISOString(); // WALL-CLOCK-ALLOWED: run metadata
    const durationMs = Date.now() - startMs; // WALL-CLOCK-ALLOWED: run metadata

    // Build post-scenario state for assertion engine
    const state = this.buildPostScenarioState();

    // Run assertions
    const assertionResults = InvariantAssertionEngine.runAssertions(
      this.scenario.assertions,
      state,
      assertors
    );

    const passed = assertionResults.filter(a => a.pass).length;
    const failed = assertionResults.filter(a => !a.pass).length;

    return {
      scenarioId: this.scenario.scenarioId,
      scenarioName: this.scenario.name,
      runId: `fault-${this.scenario.scenarioId.toLowerCase()}-${Date.now()}`, // WALL-CLOCK-ALLOWED: run id
      mode: 'fault',
      startedAt,
      completedAt,
      durationMs,
      faultsActivated: this.injector.getActivationLog().length,
      assertions: assertionResults,
      assertionsPassed: passed,
      assertionsFailed: failed,
      pass: failed === 0,
      errors: [...this.errors],
      finalPickState: this.pickStore.getAll(),
      lifecycleTrace: this.lifecycleRunner.getTrace(),
      activatedFaults: this.injector.getActivationLog(),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // DISPATCH — canonical pipeline, same validators as production
  // ─────────────────────────────────────────────────────────────

  private async dispatch(event: ReplayEvent): Promise<void> {
    const clock = this.clock;
    const runId = this.scenario.scenarioId;

    switch (event.eventType) {
      case 'PICK_SUBMITTED': {
        // Orchestrator-controlled trigger: drawdown freeze check
        if (this.systemFrozen) {
          const msg = `AutopilotFrozenError: System frozen after ${this.consecutiveLosses} consecutive losses. Submission blocked.`;
          this.errors.push({
            eventId: event.eventId,
            eventType: event.eventType,
            pickId: event.pickId,
            error: msg,
            sequenceNumber: event.sequenceNumber,
          });
          this.freezeViolationDetected = true;
          this.freezeViolationMessage = msg;
          return;
        }

        const pick = (event.payload['pick'] ?? {}) as Partial<LifecyclePick> & { id: string };
        const result = this.lifecycleRunner.insert(pick, {
          writerRole: 'submitter',
          traceId: `fault-${runId}-${event.eventId}`,
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
        break;
      }

      case 'PICK_GRADED': {
        if (!event.pickId) break;

        const gradingData = (event.payload['gradingData'] ?? {}) as Record<string, unknown>;

        // Orchestrator-controlled trigger: staleness check
        const isStaleEvent =
          gradingData['isStale'] === true || gradingData['dataQuality'] === 'stale';
        if (isStaleEvent) {
          const marketTs = gradingData['marketTimestamp'] as string | undefined;
          const isTimestampStale = marketTs
            ? clock.now().getTime() - new Date(marketTs).getTime() > STALE_AGE_MS
            : true;
          if (isTimestampStale || isStaleEvent) {
            const blockResult = this.lifecycleRunner.update(
              event.pickId,
              {
                blocked_reason: 'stale-market-data',
                blocked_at: clock.now().toISOString(),
                promotion_status: 'failed',
              },
              {
                writerRole: 'promoter',
                traceId: `fault-${runId}-stale-${event.eventId}`,
                clock,
                skipTransitionValidation: true,
              }
            );
            if (!blockResult.success) {
              this.errors.push({
                eventId: event.eventId,
                eventType: event.eventType,
                pickId: event.pickId,
                error: blockResult.error ?? 'stale block failed',
                sequenceNumber: event.sequenceNumber,
              });
            }
            break;
          }
        }

        // Orchestrator-controlled trigger: quality degradation check
        const qualityScore = gradingData['qualityScore'] as number | undefined;
        if (qualityScore !== undefined && qualityScore < QUALITY_THRESHOLD) {
          const blockResult = this.lifecycleRunner.update(
            event.pickId,
            {
              blocked_reason: 'degraded-quality',
              blocked_at: clock.now().toISOString(),
              promotion_status: 'failed',
            },
            {
              writerRole: 'promoter',
              traceId: `fault-${runId}-quality-${event.eventId}`,
              clock,
              skipTransitionValidation: true,
            }
          );
          if (!blockResult.success) {
            this.errors.push({
              eventId: event.eventId,
              eventType: event.eventType,
              pickId: event.pickId,
              error: blockResult.error ?? 'quality block failed',
              sequenceNumber: event.sequenceNumber,
            });
          }
          break;
        }

        // Normal promotion path
        const result = this.lifecycleRunner.update(event.pickId, gradingData, {
          writerRole: 'promoter',
          traceId: `fault-${runId}-${event.eventId}`,
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
        break;
      }

      case 'PICK_POSTED': {
        if (!event.pickId) break;

        const claimResult = this.lifecycleRunner.claimForPosting(event.pickId, {
          writerRole: 'poster',
          traceId: `fault-${runId}-${event.eventId}`,
          clock,
        });

        if (claimResult.success) {
          // Publish through fault adapter (may throw if fault is injected)
          const posting = (event.payload['posting'] ?? {}) as Record<string, unknown>;
          await this.publishAdapter.publish(event.pickId, posting);
        } else if (claimResult.error !== 'Already claimed (idempotent)') {
          this.errors.push({
            eventId: event.eventId,
            eventType: event.eventType,
            pickId: event.pickId,
            error: claimResult.error ?? 'claim failed',
            sequenceNumber: event.sequenceNumber,
          });
        }
        break;
      }

      case 'PICK_SETTLED': {
        if (!event.pickId) break;

        const settlementData = await this.settlementAdapter.checkSettlement(event.pickId, clock);
        if (!settlementData) {
          this.errors.push({
            eventId: event.eventId,
            eventType: event.eventType,
            pickId: event.pickId,
            error: 'No settlement data found in EventStore (missing settlement source)',
            sequenceNumber: event.sequenceNumber,
          });
          break;
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
            traceId: `fault-${runId}-${event.eventId}`,
            clock,
          }
        );

        if (!result.success) {
          // F6 immutability: second settle on already-settled pick
          const isImmutabilityViolation =
            result.error?.includes('transition') ||
            result.error?.includes('Invalid') ||
            result.error?.includes('Concurrent') ||
            result.error?.includes('settle');
          if (isImmutabilityViolation) {
            this.freezeViolationDetected = true;
            this.freezeViolationMessage = result.error;
          }
          this.errors.push({
            eventId: event.eventId,
            eventType: event.eventType,
            pickId: event.pickId,
            error: result.error ?? 'settlement failed',
            sequenceNumber: event.sequenceNumber,
          });
          break;
        }

        // Orchestrator-controlled trigger: drawdown monitor
        if (settlementData.result === 'loss') {
          this.consecutiveLosses++;
          if (this.consecutiveLosses >= DRAWDOWN_THRESHOLD && !this.systemFrozen) {
            this.systemFrozen = true;
            this.injector.recordActivation(
              'orchestrator.drawdown',
              'throw',
              this.consecutiveLosses,
              event.pickId,
              `HARD_FREEZE: ${this.consecutiveLosses} consecutive losses exceeded threshold (${DRAWDOWN_THRESHOLD})`
            );
          }
        } else {
          this.consecutiveLosses = 0; // Reset on non-loss
        }
        break;
      }

      case 'RECAP_TRIGGERED': {
        const period = (event.payload['period'] as 'daily' | 'weekly' | 'monthly') ?? 'daily';
        await this.recapAdapter.generate(period, clock);
        break;
      }

      default:
        // Unknown event — skip silently
        break;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // STATE BUILDER
  // ─────────────────────────────────────────────────────────────

  private buildPostScenarioState(): PostScenarioState {
    return {
      scenarioId: this.scenario.scenarioId,
      lifecycleTrace: this.lifecycleRunner.getTrace(),
      finalPickState: this.pickStore.getAll(),
      publishRecords: this.publishAdapter.getRecords(),
      publishCallCount: this.publishAdapter.totalCallCount,
      suppressedAlertCount: this.notificationAdapter.suppressedCount,
      errors: [...this.errors],
      activatedFaults: this.injector.getActivationLog(),
      recapRecords: this.recapAdapter.getRecords().map(r => ({ // @ts-expect-error V1 code duplicate key
        period: r.period, ...r.output })),
      settlementCheckCount: this.settlementAdapter.totalCallCount,
      freezeViolationDetected: this.freezeViolationDetected,
      freezeViolationMessage: this.freezeViolationMessage,
    };
  }

  /** Access the determinism hash for this run (for multi-run verification). */
  getDeterminismHash(eventsProcessed: number): string {
    return DeterminismValidator.computeHash(eventsProcessed, this.pickStore.getSnapshot(), [
      ...this.lifecycleRunner.getTrace(),
    ]);
  }

  getPickStore(): IsolatedPickStore {
    return this.pickStore;
  }
}
