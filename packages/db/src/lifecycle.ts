import {
  createLifecycleEvent,
  type PickLifecycleState,
  type WriterRole,
} from '@unit-talk/contracts';
import type { PickRepository } from './repositories.js';
import type { PickLifecycleRecord } from './types.js';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Thrown when a lifecycle transition is not allowed by the FSM.
 *
 * Forbidden transitions (documented):
 *  - settled -> * — settlement is final
 *  - voided  -> * — void is final
 *  - posted  -> validated — no regression
 *  - posted  -> queued    — no regression
 *  - awaiting_approval -> posted — must go through queued first
 *  - awaiting_approval -> settled — must go through queued and posted first
 *  - awaiting_approval -> validated — no regression back to pre-approval state
 *  - awaiting_approval -> draft — no regression
 *  - draft -> awaiting_approval — must validate first
 */
export class InvalidTransitionError extends Error {
  public readonly fromState: PickLifecycleState;
  public readonly toState: PickLifecycleState;

  constructor(fromState: PickLifecycleState, toState: PickLifecycleState) {
    super(`Invalid lifecycle transition: ${fromState} -> ${toState}`);
    this.name = 'InvalidTransitionError';
    this.fromState = fromState;
    this.toState = toState;
  }
}

/** Thrown when the pick cannot be found or is in an unexpected state. */
export class InvalidPickStateError extends Error {
  public readonly pickId: string;

  constructor(pickId: string, detail?: string) {
    super(
      detail
        ? `Invalid pick state for ${pickId}: ${detail}`
        : `Cannot transition unknown pick: ${pickId}`,
    );
    this.name = 'InvalidPickStateError';
    this.pickId = pickId;
  }
}

// ---------------------------------------------------------------------------
// Allowed-transitions map (single source of truth)
// ---------------------------------------------------------------------------

/**
 * The canonical lifecycle FSM.
 *
 * Terminal states (`settled`, `voided`) have no outgoing transitions.
 * Regression transitions (e.g. posted -> validated) are forbidden by omission.
 *
 * Phase 7A (UTV2-491): `awaiting_approval` is a governance brake state for
 * non-human producers. Valid forward paths: `queued` (approved) or `voided`
 * (rejected). Not a terminal state, but has no backward transitions and
 * cannot skip directly to `posted` or `settled`.
 */
const allowedTransitions: Record<PickLifecycleState, PickLifecycleState[]> = {
  draft: ['validated', 'voided'],
  validated: ['queued', 'awaiting_approval', 'voided'],
  awaiting_approval: ['queued', 'voided'],
  queued: ['posted', 'voided'],
  posted: ['settled', 'voided'],
  settled: [],
  voided: [],
};

// ---------------------------------------------------------------------------
// Helper exports
// ---------------------------------------------------------------------------

/** Returns the list of valid next states for a given state. */
export function getAllowedTransitions(
  fromState: PickLifecycleState,
): PickLifecycleState[] {
  return allowedTransitions[fromState] ?? [];
}

/** Returns `true` for terminal states (`settled`, `voided`). */
export function isTerminalState(state: PickLifecycleState): boolean {
  return state === 'settled' || state === 'voided';
}

// ---------------------------------------------------------------------------
// Transition result
// ---------------------------------------------------------------------------

export interface LifecycleTransitionResult {
  pickId: string;
  lifecycleState: PickLifecycleState;
  lifecycleEvent: PickLifecycleRecord;
}

// ---------------------------------------------------------------------------
// Core transition function
// ---------------------------------------------------------------------------

export async function transitionPickLifecycle(
  pickRepository: PickRepository,
  pickId: string,
  toState: PickLifecycleState,
  reason: string,
  writerRole: WriterRole = 'promoter',
): Promise<LifecycleTransitionResult> {
  const existing = await pickRepository.findPickById(pickId);
  if (!existing) {
    throw new InvalidPickStateError(pickId);
  }

  const fromState = existing.status as PickLifecycleState;
  const allowed = allowedTransitions[fromState] ?? [];
  if (!allowed.includes(toState)) {
    throw new InvalidTransitionError(fromState, toState);
  }

  // Timestamp invariant (warning-only): created_at should exist and precede now
  if (toState === 'posted' || toState === 'settled') {
    const createdAt = existing.created_at;
    if (!createdAt) {
      console.warn(
        `[lifecycle] pick ${pickId}: missing created_at during transition to ${toState}`,
      );
    } else if (new Date(createdAt) > new Date()) {
      console.warn(
        `[lifecycle] pick ${pickId}: created_at (${createdAt}) is in the future during transition to ${toState}`,
      );
    }
  }

  // UTV2-519 P7A-04 Corrective: try the atomic RPC path first. Postgres wraps
  // the UPDATE picks.status + INSERT pick_lifecycle in a single transaction,
  // closing the race window where a lifecycle event insert could fail a CHECK
  // (e.g. the UTV2-491 awaiting_approval gap) after picks.status was already
  // committed. When the repository is InMemory the call throws the sentinel
  // message below and we fall back to the pre-existing sequential path.
  // UTV2-520: transitionPickLifecycleAtomic is now required on the interface.
  // The typeof guard has been removed; only the InMemory sentinel catch remains.
  try {
    const atomicResult = await pickRepository.transitionPickLifecycleAtomic({
      pickId,
      fromState,
      toState,
      writerRole,
      reason,
    });

    const lifecycleEvent: PickLifecycleRecord = {
      id: atomicResult.eventId,
      pick_id: pickId,
      from_state: fromState,
      to_state: toState,
      writer_role: writerRole,
      reason,
      payload: {},
      created_at: new Date().toISOString(),
    };

    return {
      pickId,
      lifecycleState: toState,
      lifecycleEvent,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isInMemorySentinel = message.includes(
      'transitionPickLifecycleAtomic is not supported in InMemory mode',
    );
    if (!isInMemorySentinel) {
      // Real DB error, typed FSM error, or not-found — do NOT fall back to
      // sequential writes, which would mask the live rollback semantics we
      // just added in UTV2-519.
      throw err;
    }
  }

  // Sequential fallback — only reached under InMemory mode where Postgres
  // constraint enforcement does not apply.
  await pickRepository.updatePickLifecycleState(pickId, toState);
  const lifecycleEvent = await pickRepository.saveLifecycleEvent(
    createLifecycleEvent(pickId, toState, writerRole, reason, fromState),
  );

  return {
    pickId,
    lifecycleState: toState,
    lifecycleEvent,
  };
}

export async function ensurePickLifecycleState(
  pickRepository: PickRepository,
  pickId: string,
  targetState: PickLifecycleState,
  reason: string,
  writerRole: WriterRole = 'promoter',
): Promise<LifecycleTransitionResult | null> {
  const existing = await pickRepository.findPickById(pickId);
  if (!existing) {
    throw new InvalidPickStateError(pickId);
  }

  if (existing.status === targetState) {
    return null;
  }

  return transitionPickLifecycle(pickRepository, pickId, targetState, reason, writerRole);
}

// ---------------------------------------------------------------------------
// Atomic claim (idempotent transition)
// ---------------------------------------------------------------------------

export interface ClaimResult {
  claimed: boolean;
  pickId: string;
}

/**
 * Atomically claim a pick for a lifecycle transition using a conditional
 * UPDATE ... WHERE status = expectedCurrentState pattern. Returns
 * { claimed: true } only if the pick was in the expected state and was
 * successfully transitioned. Returns { claimed: false } (no error) if
 * the pick was already in a different state — making the call idempotent
 * and safe under concurrent worker cycles.
 */
export async function atomicClaimForTransition(
  pickRepository: PickRepository,
  pickId: string,
  expectedCurrentState: PickLifecycleState,
  targetState: PickLifecycleState,
): Promise<ClaimResult> {
  const allowed = allowedTransitions[expectedCurrentState] ?? [];
  if (!allowed.includes(targetState)) {
    return { claimed: false, pickId };
  }

  const { claimed } = await pickRepository.claimPickTransition(
    pickId,
    expectedCurrentState,
    targetState,
  );

  return { claimed, pickId };
}
