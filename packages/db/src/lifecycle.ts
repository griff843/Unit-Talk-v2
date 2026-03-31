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
 */
const allowedTransitions: Record<PickLifecycleState, PickLifecycleState[]> = {
  draft: ['validated', 'voided'],
  validated: ['queued', 'voided'],
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
