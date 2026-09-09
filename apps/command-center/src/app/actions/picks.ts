'use server';

import { getPickDetail } from '@/lib/data';
import { resolveActorOrRefusal } from '@/lib/require-actor';
import type { PickDetailViewResponse } from '@/lib/data/queues';

/**
 * Reads a pick's full detail through the service-role data client.
 *
 * This action was the reason the matcher bug had teeth. `/picks/[id]` is the
 * dynamic route the old matcher exempted, and this is what its page calls: a
 * server action that performs a service-role read and does no authorization of
 * its own. `client.ts` asserts only that credentials are *configured*, never
 * that the caller presented any, so on a correctly configured deployment it
 * would answer a middleware-bypassing request with privileged data.
 *
 * Refusing without a middleware-issued actor closes that. A server action is
 * independently addressable — a POST carrying the `Next-Action` header reaches
 * it directly — so it needs the check whether or not the page above it has one.
 */
export async function loadPickDetail(pickId: string): Promise<PickDetailViewResponse | null> {
  const actorResolution = await resolveActorOrRefusal();
  if (!actorResolution.ok) {
    // Null is this action's existing "nothing to show" answer, and the caller
    // already renders it. Returning it here refuses without inventing an error
    // shape the page does not handle — and, deliberately, without telling an
    // unauthenticated caller whether the pick exists.
    return null;
  }

  return getPickDetail(pickId);
}
