'use server';

import { revalidatePath } from 'next/cache';

export type ReviewDecision = 'approve' | 'deny' | 'hold' | 'return';

export type ReviewResult =
  | { ok: true; reviewId: string; approvalStatus: string }
  | { ok: false; error: string };

export async function reviewPick(
  pickId: string,
  decision: ReviewDecision,
  reason: string,
): Promise<ReviewResult> {
  const apiUrl = process.env.API_BASE_URL ?? 'http://localhost:3000';

  const res = await fetch(`${apiUrl}/api/picks/${pickId}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      decision,
      reason,
      decidedBy: 'command-center',
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
