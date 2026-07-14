'use server';

import { revalidatePath } from 'next/cache';
import {
  resolveApiBaseUrl,
  resolveCommandCenterApiHeaders,
  resolveOperatorIdentity,
} from '@/lib/server-api';

export type KillSwitchActionResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

const API_BASE = resolveApiBaseUrl();
const OPERATOR_ACTOR = resolveOperatorIdentity();

export async function setDeliveryKillSwitch(
  target: string,
  killed: boolean,
  reason: string,
): Promise<KillSwitchActionResult> {
  const res = await fetch(`${API_BASE}/api/discord/kill-switch`, {
    method: 'POST',
    headers: resolveCommandCenterApiHeaders(),
    body: JSON.stringify({ target, killed, reason, actor: OPERATOR_ACTOR }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: (body as { error?: { message?: string } }).error?.message ?? `Error ${res.status}`,
    };
  }
  revalidatePath('/operations/discord');
  return { ok: true, data: body as Record<string, unknown> };
}
