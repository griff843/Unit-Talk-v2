import {
  createDistributionWorkItem,
  type CanonicalPick,
  type DistributionWorkItem,
} from '@unit-talk/contracts';

export function buildDistributionWorkItem(
  pick: CanonicalPick,
  target: string,
): DistributionWorkItem {
  return createDistributionWorkItem(pick, target);
}
