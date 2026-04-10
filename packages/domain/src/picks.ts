import {
  createLifecycleEvent,
  materializeCanonicalPick,
  type CanonicalPick,
  type LifecycleEvent,
  type MaterializeCanonicalPickInitial,
  type ValidatedSubmission,
} from '@unit-talk/contracts';

export interface CanonicalPickMaterialization {
  pick: CanonicalPick;
  lifecycleEvent: LifecycleEvent;
}

/**
 * Create a canonical pick from a validated submission, plus the matching
 * lifecycle event that records its birth state.
 *
 * Phase 7A (UTV2-491): `initial` is an optional pass-through to
 * `materializeCanonicalPick` that allows non-human producers to land a pick
 * in `awaiting_approval` at the same atomic step as materialization. Producer
 * routing policy is NOT decided here — callers pass the state they need.
 *
 * Backward-compatible: existing single-argument callers are unaffected.
 */
export function createCanonicalPickFromSubmission(
  submission: ValidatedSubmission,
  initial?: MaterializeCanonicalPickInitial,
): CanonicalPickMaterialization {
  const pick = materializeCanonicalPick(submission, initial);
  const lifecycleEvent = createLifecycleEvent(
    pick.id,
    pick.lifecycleState,
    'submitter',
    'validated submission materialized into canonical pick',
  );

  return {
    pick,
    lifecycleEvent,
  };
}
