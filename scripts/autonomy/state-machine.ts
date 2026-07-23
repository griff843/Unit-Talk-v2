import { type ExecutionState, TERMINAL_STATES } from './contracts.js';

export const ALLOWED_TRANSITIONS: Readonly<
  Record<ExecutionState, readonly ExecutionState[]>
> = {
  created: ['evaluating'],
  evaluating: ['packet_ready', 'no_op', 'queued', 'blocked', 'escalated'],
  packet_ready: ['dispatching', 'blocked', 'escalated'],
  dispatching: ['dispatched', 'blocked', 'escalated'],
  no_op: [],
  queued: [],
  dispatched: [],
  blocked: [],
  escalated: [],
};

export function canTransition(
  from: ExecutionState,
  to: ExecutionState,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(
  from: ExecutionState,
  to: ExecutionState,
): void {
  if (!canTransition(from, to)) {
    throw new Error(`INVALID_AUTONOMY_TRANSITION:${from}->${to}`);
  }
}

export function isTerminal(state: ExecutionState): boolean {
  return TERMINAL_STATES.has(state);
}
