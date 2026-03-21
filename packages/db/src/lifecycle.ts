import {
  createLifecycleEvent,
  type PickLifecycleState,
  type WriterRole,
} from '@unit-talk/contracts';
import type { PickRepository } from './repositories.js';
import type { PickLifecycleRecord } from './types.js';

export interface LifecycleTransitionResult {
  pickId: string;
  lifecycleState: PickLifecycleState;
  lifecycleEvent: PickLifecycleRecord;
}

export async function transitionPickLifecycle(
  pickRepository: PickRepository,
  pickId: string,
  toState: PickLifecycleState,
  reason: string,
  writerRole: WriterRole = 'promoter',
): Promise<LifecycleTransitionResult> {
  const existing = await pickRepository.findPickById(pickId);
  if (!existing) {
    throw new Error(`Cannot transition unknown pick: ${pickId}`);
  }

  const allowedTransitions: Record<PickLifecycleState, PickLifecycleState[]> = {
    draft: ['validated', 'voided'],
    validated: ['queued', 'voided'],
    queued: ['posted', 'voided'],
    posted: ['settled', 'voided'],
    settled: [],
    voided: [],
  };

  const fromState = existing.status as PickLifecycleState;
  const allowed = allowedTransitions[fromState] ?? [];
  if (!allowed.includes(toState)) {
    throw new Error(`Invalid lifecycle transition: ${fromState} -> ${toState}`);
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
    throw new Error(`Cannot transition unknown pick: ${pickId}`);
  }

  if (existing.status === targetState) {
    return null;
  }

  return transitionPickLifecycle(pickRepository, pickId, targetState, reason, writerRole);
}
