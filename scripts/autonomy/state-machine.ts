import { type AutonomyMode, type CycleState } from './contracts.js';

export const ALLOWED_CYCLE_TRANSITIONS: Readonly<
  Record<CycleState, readonly CycleState[]>
> = {
  idle: ['waking'],
  waking: ['gating', 'idle'],
  gating: ['selecting', 'idle'],
  selecting: ['dispatching', 'shadow_evaluating', 'reporting'],
  dispatching: ['reporting'],
  shadow_evaluating: ['reporting'],
  reporting: ['cooling_down'],
  cooling_down: ['idle'],
};

export const OWNER_MODE_TRANSITIONS: Readonly<
  Record<AutonomyMode, readonly AutonomyMode[]>
> = {
  halted: ['halted', 'shadow'],
  shadow: ['halted', 't3_live'],
  t3_live: ['halted', 'shadow', 't2t3_live'],
  t2t3_live: ['halted', 't3_live'],
};

export const KERNEL_ROLLBACK_TRANSITIONS: Readonly<
  Partial<Record<AutonomyMode, AutonomyMode>>
> = {
  t3_live: 'shadow',
  t2t3_live: 't3_live',
};

export function canTransitionCycle(from: CycleState, to: CycleState): boolean {
  return ALLOWED_CYCLE_TRANSITIONS[from].includes(to);
}

export function assertCycleTransition(from: CycleState, to: CycleState): void {
  if (!canTransitionCycle(from, to)) {
    throw new Error(`INVALID_AUTONOMY_CYCLE_TRANSITION:${from}->${to}`);
  }
}

export function canOwnerTransitionMode(
  from: AutonomyMode,
  to: AutonomyMode,
): boolean {
  return OWNER_MODE_TRANSITIONS[from].includes(to);
}

export function assertOwnerModeTransition(
  from: AutonomyMode,
  to: AutonomyMode,
): void {
  if (!canOwnerTransitionMode(from, to)) {
    throw new Error(`INVALID_OWNER_MODE_TRANSITION:${from}->${to}`);
  }
}
