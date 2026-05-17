/**
 * Pick OUTCOME lifecycle — tracks a pick from scoring to settlement result.
 * This is separate from the pick DELIVERY lifecycle in @unit-talk/contracts
 * (draft -> validated -> queued -> posted -> settled/voided), which governs
 * ingestion and delivery. These two state machines operate on different
 * dimensions and must not be conflated.
 */

// Explicit outcome states — not derived from CanonicalPick (which tracks
// delivery lifecycle state, not outcome state).
export type PickLifecycleStatus =
  | 'pending'
  | 'qualified'
  | 'disqualified'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'sent'
  | 'cancelled'
  | 'won'
  | 'lost'
  | 'push'
  | 'void';

const transitionEntries = [
  ['pending', ['qualified', 'disqualified']],
  ['qualified', ['approved', 'awaiting_approval']],
  ['awaiting_approval', ['approved', 'rejected']],
  ['approved', ['sent', 'cancelled']],
  ['sent', ['won', 'lost', 'push', 'void']],
  ['disqualified', []],
  ['rejected', []],
  ['cancelled', []],
  ['won', []],
  ['lost', []],
  ['push', []],
  ['void', []],
] as const satisfies readonly (readonly [PickLifecycleStatus, readonly PickLifecycleStatus[]])[];

export const VALID_TRANSITIONS: Readonly<Map<string, ReadonlySet<string>>> = new Map(
  transitionEntries.map(([from, to]) => [from, new Set<string>(to)]),
);

export class InvalidLifecycleTransitionError extends Error {
  readonly from: string;
  readonly to: string;

  constructor(from: string, to: string) {
    super(`Invalid lifecycle transition from '${from}' to '${to}'`);
    this.name = 'InvalidLifecycleTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function isValidTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS.get(from)?.has(to) ?? false;
}

export function assertValidTransition(from: string, to: string): void {
  if (!isValidTransition(from, to)) {
    throw new InvalidLifecycleTransitionError(from, to);
  }
}
