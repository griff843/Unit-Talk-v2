import {
  createLifecycleEvent,
  materializeCanonicalPick,
  type CanonicalPick,
  type LifecycleEvent,
  type ValidatedSubmission,
} from '@unit-talk/contracts';

export interface CanonicalPickMaterialization {
  pick: CanonicalPick;
  lifecycleEvent: LifecycleEvent;
}

export function createCanonicalPickFromSubmission(
  submission: ValidatedSubmission,
): CanonicalPickMaterialization {
  const pick = materializeCanonicalPick(submission);
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
