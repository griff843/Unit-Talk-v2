/**
 * Gated boundary for the two runtime reads that page components used to make
 * directly against `server-api`.
 *
 * `fetchRuntimeTruth` attaches `Authorization: Bearer $UNIT_TALK_CC_API_KEY`,
 * so an ungated page call let an anonymous request spend the operator
 * credential and land the answer in the RSC payload. `fetchRuntimeHealth`
 * spends no credential but still drives an outbound request from the operator
 * server on an anonymous caller's behalf. Both are privileged reads and both
 * assert the request's credentials first, exactly like `getDataClient`.
 */
import type { RuntimeTruthReport } from '@unit-talk/observability';
import { assertPrivilegedRequestAuthenticated } from '../request-auth';
import {
  fetchRuntimeHealth,
  fetchRuntimeTruth,
  type RuntimeHealthSummary,
} from '../server-api';

export async function getRuntimeTruth(): Promise<RuntimeTruthReport> {
  await assertPrivilegedRequestAuthenticated();
  return fetchRuntimeTruth();
}

export async function getRuntimeHealth(): Promise<RuntimeHealthSummary> {
  await assertPrivilegedRequestAuthenticated();
  return fetchRuntimeHealth();
}
