'use server';

import { revalidatePath } from 'next/cache';

export type SettleResult =
  | { ok: true; settlementRecordId: string }
  | { ok: false; error: string };

/**
 * Settle or void a pick via the Unit Talk API.
 *
 * The settlement contract requires:
 *  - status: 'settled' for win / loss / push / void (void is a result, not a status)
 *  - result: the concrete outcome (win | loss | push | void)
 *  - confidence: one of 'confirmed' | 'estimated' | 'pending'
 *  - evidenceRef: non-empty string (operator manual settlement marker)
 *  - source: 'operator'
 *
 * When called on an already-settled pick the API automatically creates a
 * correction record (corrects_id pointing to the prior settlement), so
 * the same action covers both initial settlement and corrections.
 */
export async function settlePick(
  pickId: string,
  result: 'win' | 'loss' | 'push' | 'void',
): Promise<SettleResult> {
  const apiUrl = process.env.API_BASE_URL ?? 'http://localhost:3000';
  // Operator identity for audit logs. Replace with real auth when implemented.
  const operatorActor = process.env.OPERATOR_IDENTITY ?? 'command-center';

  const res = await fetch(`${apiUrl}/api/picks/${pickId}/settle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'settled',
      result,
      source: 'operator',
      confidence: 'confirmed',
      evidenceRef: 'operator-manual',
      settledBy: operatorActor,
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
    data?: { settlementRecordId?: string };
  };

  revalidatePath('/');

  return {
    ok: true,
    settlementRecordId: body.data?.settlementRecordId ?? '',
  };
}
