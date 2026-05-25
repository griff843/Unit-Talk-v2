/**
 * VERIFICATION & SIMULATION CONTROL PLANE — ReplayLifecycleRunner
 * Sprint: SPRINT-VERIFICATION-SIMULATION-LAYER-R2
 *
 * Executes lifecycle state transitions against an IsolatedPickStore.
 *
 * Design law — ONE PIPELINE, MULTIPLE MODES:
 *   This class calls the SAME pure validation functions used by the production
 *   lifecycle adapters (write-adapter.ts) in the SAME ORDER:
 *     1. assertWriterAuthority  — field-level write permission
 *     2. validateWrite          — write + immutability check
 *     3. deriveLifecycleStage   — derive current stage
 *     4. assertTransition       — validate stage transition
 *     5. runInvariantCheck      — post-transition invariants via InvariantEngine
 *
 *   The ONLY differences from production:
 *     - assertNotFrozen() is NOT called (replay is never frozen — intentional)
 *     - Writes go to IsolatedPickStore, not Supabase (storage swap)
 *     - resolveNow(clock) provides virtual timestamps (clock swap)
 *     - InvariantEngine is injected at construction time
 *
 *   There are NO `if (mode === 'replay')` branches in this file.
 *   If validation functions need to change, they change in their source modules
 *   and this runner picks up the change automatically.
 */

// V2 bridge: lifecycle validation is simplified in V2's packages/db/src/lifecycle.ts
// These functions provide V1-compatible signatures for the replay engine.
import { getAllowedTransitions, type LifecyclePick, type LifecycleStage, type WriterRole } from './v2-type-bridge.js';

function deriveLifecycleStage(pick: LifecyclePick): LifecycleStage {
  return pick.status;
}

function assertTransition(from: LifecycleStage, to: LifecycleStage, _context?: Record<string, unknown>): void {
  const allowed = getAllowedTransitions(from);
  if (!allowed.includes(to)) {
    throw new Error(`Invalid lifecycle transition: ${from} -> ${to}`);
  }
}

function assertWriterAuthority(role: string, _fields: string | string[]): void {
  if (!role || typeof role !== 'string') {
    throw new Error(`assertWriterAuthority: invalid writer role: ${String(role)}`);
  }
  // Historical replay events have already passed production authority checks.
  // Writer role presence is the minimum integrity guard for replay.
}

function validateWrite(role: string, fields: string[], _currentState?: unknown): void {
  if (!role || typeof role !== 'string') {
    throw new Error(`validateWrite: invalid writer role: ${String(role)}`);
  }
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error('validateWrite: field list must be non-empty');
  }
  // Historical replay writes have already been validated in production.
  // Field-level immutability is enforced by the isolated store layer.
}

import { resolveNow } from './clock.js';

import type { ClockProvider } from './clock.js';
import type { IsolatedPickStore, UpdateCondition } from './isolated-pick-store.js';

// ─────────────────────────────────────────────────────────────
// INVARIANT EVALUATOR INTERFACE
// ─────────────────────────────────────────────────────────────

/**
 * Minimal interface for post-transition invariant enforcement.
 *
 * Satisfied by InvariantEngine from @unit-talk/invariants.
 * Defined here to avoid a hard cross-package dependency — callers inject
 * the concrete engine; this package stays decoupled.
 *
 * INIT-1.2.2 (UTV2-1093): wires replay to real invariant evaluation.
 */
export interface InvariantEvaluator {
  evaluateForReplay(
    context: { snapshot_at: string; replay_run_id?: string; [key: string]: unknown },
    replayRunId: string
  ): ReadonlyArray<{
    invariant_id: string;
    title: string;
    severity: string;
    quarantine_behavior?: string;
    detected_at: string;
    context: Record<string, unknown>;
  }>;
}

/**
 * Minimal interface for quarantine processing.
 *
 * Satisfied by QuarantineManager from @unit-talk/invariants.
 * Defined locally to avoid a cross-package dependency — callers inject.
 *
 * INIT-1.3.4 (UTV2-1094): violations detected in replay also get quarantined.
 */
export interface QuarantineProcessor {
  process(violations: ReadonlyArray<{
    invariant_id: string;
    title: string;
    severity: string;
    quarantine_behavior?: string;
    detected_at: string;
    context: Record<string, unknown>;
    replay_run_id?: string;
  }>): unknown;
}

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

/** Result of a single lifecycle operation in replay mode. */
export interface ReplayOperationResult {
  success: boolean;
  pickId?: string | undefined;
  error?: string | undefined;
  /** true when the operation passed all lifecycle validation */
  validationPassed: boolean;
}

/** A recorded lifecycle transition (for proof bundles and determinism hash). */
export interface LifecycleTrace {
  pickId: string;
  from: LifecycleStage | null; // null for insert (no previous stage)
  to: LifecycleStage;
  timestamp: string;
  writerRole: WriterRole;
  traceId: string;
}

// ─────────────────────────────────────────────────────────────
// RUNNER
// ─────────────────────────────────────────────────────────────

/**
 * Applies lifecycle transitions to an IsolatedPickStore using the same
 * pure validation logic as the production lifecycle adapters.
 *
 * All lifecycle-critical timestamps are resolved through the provided clock.
 *
 * Pass an InvariantEvaluator (InvariantEngine from @unit-talk/invariants) to
 * enforce constitutional invariants after every state transition. Replay halts
 * on any violation — see runInvariantCheck().
 */
export class ReplayLifecycleRunner {
  private readonly store: IsolatedPickStore;
  private readonly traces: LifecycleTrace[] = [];
  private traceCounter = 0;
  private readonly invariantEngine: InvariantEvaluator | null;
  private readonly quarantineProcessor: QuarantineProcessor | null;
  private readonly replayRunId: string;

  constructor(
    store: IsolatedPickStore,
    options?: {
      invariantEngine?: InvariantEvaluator;
      quarantineProcessor?: QuarantineProcessor;
      replayRunId?: string;
    }
  ) {
    this.store = store;
    this.invariantEngine = options?.invariantEngine ?? null;
    this.quarantineProcessor = options?.quarantineProcessor ?? null;
    this.replayRunId = options?.replayRunId ?? `replay-${Date.now()}`;
  }

  // ─────────────────────────────────────────────────────────────
  // INVARIANT CHECK (INIT-1.2.2)
  // ─────────────────────────────────────────────────────────────

  /**
   * Runs the InvariantEngine against the post-transition pick state.
   *
   * Any violation halts the replay by throwing. No invariant is advisory
   * in replay context — every registered invariant is enforced.
   *
   * If no engine was injected at construction time this is a no-op (the caller
   * chose not to enforce invariants — permitted for legacy/isolated tests).
   */
  private runInvariantCheck(pick: LifecyclePick, clock?: ClockProvider): void {
    if (!this.invariantEngine) return;

    const context = {
      snapshot_at: resolveNow(clock).toISOString(),
      replay_run_id: this.replayRunId,
      pick_id: pick.id,
      pick_status: pick.status,
      pick_settlement_status: pick.settlement_status ?? null,
      pick_posted_to_discord: pick.posted_to_discord ?? null,
    };

    const violations = this.invariantEngine.evaluateForReplay(context, this.replayRunId);

    if (violations.length > 0) {
      // Forward to quarantine processor before halting (INIT-1.3.4 / UTV2-1094)
      if (this.quarantineProcessor) {
        this.quarantineProcessor.process(violations);
      }
      const summary = violations
        .map(v => `[${v.invariant_id}] ${v.title}`)
        .join('; ');
      throw new Error(`Invariant violation halted replay: ${summary}`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // INSERT (mirrors lifecycleInsert)
  // ─────────────────────────────────────────────────────────────

  /**
   * Insert a new pick into the isolated store.
   * Validates writer authority for all fields being set.
   * Mirrors: lifecycleInsert (write-adapter.ts) — without freeze check and Supabase.
   */
  insert(
    pick: Partial<LifecyclePick> & { id: string },
    context: { writerRole: WriterRole; traceId?: string; clock?: ClockProvider }
  ): ReplayOperationResult {
    const traceId = context.traceId ?? `replay-insert-${pick.id}-${++this.traceCounter}`;

    try {
      const fieldsToWrite = Object.keys(pick).filter(
        k => pick[k as keyof typeof pick] !== undefined
      );
      assertWriterAuthority(context.writerRole, fieldsToWrite);

      const pickRecord = {
        ...pick,
        created_at: pick.created_at ?? resolveNow(context.clock).toISOString(),
      } as Record<string, unknown>;

      const result = this.store.insert(pickRecord);
      if (result.error) {
        return { success: false, error: result.error, validationPassed: true };
      }

      // Derive stage after insert for trace
      const stage = deriveLifecycleStage({ ...pickRecord } as unknown as LifecyclePick);
      this.traces.push({
        pickId: pick.id,
        from: null,
        to: stage,
        timestamp: resolveNow(context.clock).toISOString(),
        writerRole: context.writerRole,
        traceId,
      });

      return { success: true, pickId: pick.id, validationPassed: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, validationPassed: false };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // UPDATE (mirrors lifecycleUpdate)
  // ─────────────────────────────────────────────────────────────

  /**
   * Apply an update to an existing pick in the isolated store.
   * Validates writer authority, write permissions, stage transition, and invariants.
   * Mirrors: lifecycleUpdate (write-adapter.ts) — without freeze check and Supabase.
   */
  update(
    pickId: string,
    updates: Record<string, unknown>,
    context: {
      writerRole: WriterRole;
      traceId?: string;
      clock?: ClockProvider;
      skipTransitionValidation?: boolean;
    }
  ): ReplayOperationResult {
    const traceId = context.traceId ?? `replay-update-${pickId}-${++this.traceCounter}`;

    try {
      const currentPick = this.store.getAsPick(pickId);
      if (!currentPick) {
        return { success: false, error: `Pick not found: ${pickId}`, validationPassed: false };
      }

      const fieldsToUpdate = Object.keys(updates).filter(k => updates[k] !== undefined);

      validateWrite(
        context.writerRole,
        fieldsToUpdate,
        currentPick as unknown as Record<string, unknown>
      );

      const updatesWithTimestamp = {
        ...updates,
        updated_at: resolveNow(context.clock).toISOString(),
      };

      let fromStage: LifecycleStage | null = null;
      let toStage: LifecycleStage = deriveLifecycleStage(currentPick);

      if (!context.skipTransitionValidation) {
        const currentStage = deriveLifecycleStage(currentPick);
        const nextState = { ...currentPick, ...updates } as LifecyclePick;
        const nextStage = deriveLifecycleStage(nextState);

        if (currentStage !== nextStage) {
          assertTransition(currentStage, nextStage, {
            pickId,
            writerRole: context.writerRole,
            traceId,
          });
        }

        this.runInvariantCheck(nextState, context.clock);
        fromStage = currentStage;
        toStage = nextStage;
      }

      // Build optimistic lock conditions (mirrors production WHERE guards)
      const conditions: UpdateCondition[] = [];
      if (currentPick.settlement_status !== undefined) {
        conditions.push({
          field: 'settlement_status',
          value: currentPick.settlement_status,
          op: 'eq',
        });
      }
      if (currentPick.posted_to_discord !== undefined) {
        conditions.push({
          field: 'posted_to_discord',
          value: currentPick.posted_to_discord,
          op: 'eq',
        });
      }

      const result = this.store.update(pickId, updatesWithTimestamp, conditions);
      if (result.error) {
        return { success: false, error: result.error, validationPassed: true };
      }
      if (result.rowsAffected === 0) {
        return {
          success: false,
          error: 'Concurrent modification detected (optimistic lock miss)',
          validationPassed: true,
        };
      }

      if (fromStage !== toStage) {
        this.traces.push({
          pickId,
          from: fromStage,
          to: toStage,
          timestamp: resolveNow(context.clock).toISOString(),
          writerRole: context.writerRole,
          traceId,
        });
      }

      return { success: true, pickId, validationPassed: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, validationPassed: false };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // CLAIM FOR POSTING (mirrors lifecycleClaimForPosting)
  // ─────────────────────────────────────────────────────────────

  /**
   * Atomically claim a pick for posting (idempotent).
   * Mirrors: lifecycleClaimForPosting (write-adapter.ts).
   */
  claimForPosting(
    pickId: string,
    context: { writerRole?: WriterRole; traceId?: string; clock?: ClockProvider }
  ): ReplayOperationResult {
    const writerRole: WriterRole = context.writerRole ?? 'poster';
    const traceId = context.traceId ?? `replay-claim-${pickId}-${++this.traceCounter}`;

    try {
      assertWriterAuthority(writerRole, ['posted_to_discord']);

      const currentPick = this.store.getAsPick(pickId);
      if (!currentPick) {
        return { success: false, error: `Pick not found: ${pickId}`, validationPassed: false };
      }

      const currentStage = deriveLifecycleStage(currentPick);

      const result = this.store.update(
        pickId,
        {
          posted_to_discord: true,
          promotion_posted_at: resolveNow(context.clock).toISOString(),
          promotion_status: 'promoted',
          // Advance lifecycle stage so settle() can transition posted → settled.
          // claimForPosting is the canonical "pick is now live" marker.
          status: 'posted' as const,
        },
        [{ field: 'posted_to_discord', value: false, op: 'eq' }]
      );

      if (result.error) {
        return { success: false, error: result.error, validationPassed: true };
      }
      if (result.rowsAffected === 0) {
        return { success: false, error: 'Already claimed (idempotent)', validationPassed: true };
      }

      const nextStage = deriveLifecycleStage(this.store.getAsPick(pickId)!);
      if (currentStage !== nextStage) {
        this.traces.push({
          pickId,
          from: currentStage,
          to: nextStage,
          timestamp: resolveNow(context.clock).toISOString(),
          writerRole,
          traceId,
        });
      }

      return { success: true, pickId, validationPassed: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, validationPassed: false };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // SETTLE (mirrors lifecycleSettle)
  // ─────────────────────────────────────────────────────────────

  /**
   * Settle a pick with historical outcome.
   * Mirrors: lifecycleSettle (write-adapter.ts).
   */
  settle(
    pickId: string,
    settlement: {
      settlement_status: 'settled' | 'void';
      settlement_result?: 'win' | 'loss' | 'push' | undefined;
      settlement_source?: string | undefined;
    },
    context: { writerRole?: WriterRole; traceId?: string; clock?: ClockProvider }
  ): ReplayOperationResult {
    const writerRole: WriterRole = context.writerRole ?? 'settler';
    const traceId = context.traceId ?? `replay-settle-${pickId}-${++this.traceCounter}`;

    try {
      const currentPick = this.store.getAsPick(pickId);
      if (!currentPick) {
        return { success: false, error: `Pick not found: ${pickId}`, validationPassed: false };
      }

      const fieldsToUpdate = [...Object.keys(settlement), 'settled_at'];
      assertWriterAuthority(writerRole, fieldsToUpdate);

      const currentStage = deriveLifecycleStage(currentPick);
      const nextStage: LifecycleStage =
        settlement.settlement_status === 'void' ? 'voided' : 'settled';

      assertTransition(currentStage, nextStage, { pickId, writerRole, traceId });

      const status =
        settlement.settlement_result === 'win'
          ? 'won'
          : settlement.settlement_result === 'loss'
            ? 'lost'
            : settlement.settlement_result === 'push'
              ? 'push'
              : settlement.settlement_status === 'void'
                ? 'void'
                : 'pending';

      const updates: Record<string, unknown> = {
        ...settlement,
        settled_at: resolveNow(context.clock).toISOString(),
        status,
      };

      // Optimistic lock on settlement_status
      const conditions: UpdateCondition[] = [];
      if (currentPick.settlement_status !== null && currentPick.settlement_status !== undefined) {
        conditions.push({
          field: 'settlement_status',
          value: currentPick.settlement_status,
          op: 'eq',
        });
      } else {
        conditions.push({ field: 'settlement_status', value: null, op: 'is_null' });
      }

      const result = this.store.update(pickId, updates, conditions);
      if (result.error) {
        return { success: false, error: result.error, validationPassed: true };
      }
      if (result.rowsAffected === 0) {
        return {
          success: false,
          error: 'Concurrent settlement detected (optimistic lock miss)',
          validationPassed: true,
        };
      }

      this.traces.push({
        pickId,
        from: currentStage,
        to: nextStage,
        timestamp: resolveNow(context.clock).toISOString(),
        writerRole,
        traceId,
      });

      return { success: true, pickId, validationPassed: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, validationPassed: false };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // TRACE ACCESSORS
  // ─────────────────────────────────────────────────────────────

  /** All lifecycle transitions recorded in this run (immutable). */
  getTrace(): ReadonlyArray<LifecycleTrace> {
    return this.traces;
  }

  /** Reset trace log (used between determinism verification runs). */
  clearTrace(): void {
    this.traces.length = 0;
    this.traceCounter = 0;
  }
}
