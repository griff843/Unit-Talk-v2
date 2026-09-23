'use server';

import { revalidatePath } from 'next/cache';
import {
  resolveApiBaseUrl,
  resolveCommandCenterApiHeaders,
} from '@/lib/server-api';
import { resolveActorOrRefusal } from '@/lib/require-actor';
import type { HumanCapperRecapResult } from '@/lib/human-capper-recap';
import {
  resolveOperatorGradingContext,
  type OperatorGradingContextInput,
} from '@/lib/operator-grading-context';

export type SettleResult =
  | {
      ok: true;
      settlementRecordId: string;
      /**
       * UTV2-1939: present only when the API treated this pick as a
       * human-capper delivery. `settle-pick-controller.ts` computes it
       * deliberately -- "an operator who settles a delivered pick needs to know
       * whether members were told" -- and this action used to drop it, so a
       * suppressed recap rendered as unqualified success. Absent means the
       * pick is not a human-capper delivery, which is NOT a suppressed recap.
       */
      recap?: HumanCapperRecapResult;
    }
  | { ok: false; error: string };

/**
 * Settle or correct a pick via the Unit Talk API.
 *
 * The settlement contract requires:
 *  - status: 'settled' for win / loss / push / void (void is a result, not a status)
 *  - result: the concrete outcome (win | loss | push | void)
 *  - confidence: one of 'confirmed' | 'estimated' | 'pending'
 *  - evidenceRef: non-empty string
 *  - source: 'operator'
 *
 * The `attestation` is **required**, and that is the repair this action
 * carries. Every Smart Form Track Only pick is on the evidence plane —
 * `apps/api/src/settlement-service.ts` treats `awaiting_approval`, and
 * `validated` under Track Only, as evidence-plane states — and settling one
 * without `operatorGradingContext` is refused there with
 * `OPERATOR_GRADING_CONTEXT_REQUIRED`. This action previously sent six fields
 * and never that one, so manual settlement of a Track Only pick could not
 * succeed at all. An omitted attestation is refused here, before the request is
 * sent, naming the missing field — the API would refuse it too, but with a bare
 * 400 the operator cannot act on.
 *
 * When called on an already-settled pick the API creates a correction record
 * (`corrects_id` pointing at the prior settlement). The correction carries its
 * own attestation and its own derived `evidenceRef`, so a reader can tell what
 * the correction was based on — under the previous constant `'operator-manual'`
 * they could not.
 */
export async function settlePick(
  pickId: string,
  result: 'win' | 'loss' | 'push' | 'void',
  attestation: OperatorGradingContextInput,
): Promise<SettleResult> {
  // Authentication is resolved before the attestation is even looked at, so an
  // unauthenticated caller is refused as unauthenticated rather than as
  // malformed input. `server-action-guard.test.ts` asserts that ordering for
  // every server action in this app.
  const apiUrl = resolveApiBaseUrl();
  const actorResolution = await resolveActorOrRefusal();
  if (!actorResolution.ok) {
    return { ok: false, error: actorResolution.error };
  }
  const operatorActor = actorResolution.actor;
  const headers = resolveCommandCenterApiHeaders();

  const resolved = resolveOperatorGradingContext(attestation);
  if (!resolved.ok) {
    return { ok: false, error: resolved.errors.join('; ') };
  }

  const notes = attestation.notes?.trim();

  const res = await fetch(`${apiUrl}/api/picks/${pickId}/settle`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      status: 'settled',
      result,
      source: 'operator',
      // The operator states their own confidence. Hardcoding 'confirmed'
      // asserted certainty on the operator's behalf on every settlement,
      // including ones they were estimating.
      confidence: attestation.confidence ?? 'confirmed',
      evidenceRef: resolved.evidenceRef,
      settledBy: operatorActor,
      operatorGradingContext: resolved.context,
      ...(notes ? { notes } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return {
      ok: false,
      error: (body as { message?: string }).message ?? `API error ${res.status}`,
    };
  }

  const body = (await res.json()) as {
    data?: {
      settlementRecordId?: string;
      humanCapperRecap?: HumanCapperRecapResult;
    };
  };

  revalidatePath('/');

  const recap = body.data?.humanCapperRecap;

  return {
    ok: true,
    settlementRecordId: body.data?.settlementRecordId ?? '',
    ...(recap === undefined ? {} : { recap }),
  };
}
