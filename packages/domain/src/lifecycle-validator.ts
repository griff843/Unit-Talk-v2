import type { CanonicalPick } from '@unit-talk/contracts';

type CanonicalPickStatus = CanonicalPick extends { status: infer Status }
  ? Extract<Status, string>
  : never;

export type PickLifecycleStatus =
  [CanonicalPickStatus] extends [never]
    ?
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
        | 'void'
    : CanonicalPickStatus;

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
