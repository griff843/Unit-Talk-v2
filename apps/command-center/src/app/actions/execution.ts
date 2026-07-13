'use server';

import { revalidatePath } from 'next/cache';
import {
  resolveApiBaseUrl,
  resolveCommandCenterApiHeaders,
  resolveOperatorIdentity,
} from '@/lib/server-api';
import type { SubmissionDraft } from '@/lib/pick-builder-model';

export type SubmitPickResult =
  | { ok: true; submissionId: string; pickId: string | null }
  | { ok: false; error: string };

/**
 * Submit an operator-composed pick via POST /api/submissions.
 *
 * The endpoint accepts the SubmissionPayload contract
 * (packages/contracts/src/submission.ts). The resulting pick enters the
 * normal governed lifecycle — operator submissions always land in the
 * approval queue; this action never posts directly to members.
 */
export async function submitBuiltPick(draft: SubmissionDraft): Promise<SubmitPickResult> {
  const apiUrl = resolveApiBaseUrl();
  const headers = resolveCommandCenterApiHeaders();
  const operatorActor = resolveOperatorIdentity();

  try {
    const res = await fetch(`${apiUrl}/api/submissions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...draft,
        submittedBy: operatorActor,
      }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        errors?: string[];
        error?: { message?: string };
      };
      const detail =
        body.errors?.join('; ') ?? body.error?.message ?? body.message ?? `API error ${res.status}`;
      return { ok: false, error: detail };
    }

    const body = (await res.json()) as {
      data?: { submissionId?: string; id?: string; pickId?: string };
      submissionId?: string;
      pickId?: string;
    };

    revalidatePath('/review');
    revalidatePath('/execution/discord-preview');

    return {
      ok: true,
      submissionId: body.data?.submissionId ?? body.data?.id ?? body.submissionId ?? '',
      pickId: body.data?.pickId ?? body.pickId ?? null,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Submission request failed' };
  }
}
