'use server';

import { revalidatePath } from 'next/cache';
import {
  resolveApiBaseUrl,
  resolveCommandCenterApiHeaders,
  resolveOperatorIdentity,
} from '@/lib/server-api';

export type ReviewDecision = 'approve' | 'deny' | 'hold' | 'return';

export type ReviewResult =
  | { ok: true; reviewId: string; approvalStatus: string }
  | { ok: false; error: string };

export async function reviewPick(
  pickId: string,
  decision: ReviewDecision,
  reason: string,
): Promise<ReviewResult> {
  const apiUrl = resolveApiBaseUrl();
  const operatorActor = resolveOperatorIdentity();
  const headers = resolveCommandCenterApiHeaders();

  const res = await fetch(`${apiUrl}/api/picks/${pickId}/review`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      decision,
      reason,
      decidedBy: operatorActor,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return {
      ok: false,
      error: (body as { error?: { message?: string } }).error?.message ?? `API error ${res.status}`,
    };
  }

  const body = (await res.json()) as {
    data?: { reviewId?: string; approvalStatus?: string };
  };

  revalidatePath('/');
  revalidatePath('/review');
  revalidatePath('/held');

  return {
    ok: true,
    reviewId: body.data?.reviewId ?? '',
    approvalStatus: body.data?.approvalStatus ?? '',
  };
}

export interface BulkReviewResult {
  succeeded: string[];
  failed: string[];
}

export async function bulkReviewPicks(
  pickIds: string[],
  decision: ReviewDecision,
  reason: string,
): Promise<BulkReviewResult> {
  const succeeded: string[] = [];
  const failed: string[] = [];

  const results = await Promise.allSettled(
    pickIds.map(async (pickId) => {
      const res = await reviewPick(pickId, decision, reason);
      return { pickId, res };
    }),
  );

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.res.ok) {
      succeeded.push(result.value.pickId);
    } else if (result.status === 'fulfilled') {
      failed.push(result.value.pickId);
    } else {
      // Promise rejected — extract pickId from the settled array index
      const idx = results.indexOf(result);
      failed.push(pickIds[idx]);
    }
  }

  revalidatePath('/');
  revalidatePath('/review');
  revalidatePath('/held');

  return { succeeded, failed };
}
