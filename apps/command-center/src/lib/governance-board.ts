import type { GovernanceBoardSnapshot } from './governance-contract';
import { assertPrivilegedRequestAuthenticated } from './request-auth';
import {
  readGovernanceBoardSnapshotUnauthenticated,
  type GovernanceSnapshotOptions,
} from './governance-board.internal';

export type { GovernanceSnapshotOptions };

/** The only application-facing manifest boundary. */
export async function getGovernanceBoardSnapshot(
  options: GovernanceSnapshotOptions = {},
): Promise<GovernanceBoardSnapshot> {
  await assertPrivilegedRequestAuthenticated();
  return readGovernanceBoardSnapshotUnauthenticated(options);
}
