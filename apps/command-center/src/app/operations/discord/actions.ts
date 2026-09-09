'use server';

import { revalidatePath } from 'next/cache';
import {
  resolveApiBaseUrl,
  resolveCommandCenterApiHeaders,
} from '@/lib/server-api';
import { resolveActorOrRefusal } from '@/lib/require-actor';

export type KillSwitchActionResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

const API_BASE = resolveApiBaseUrl();

export async function setDeliveryKillSwitch(
  target: string,
  killed: boolean,
  reason: string,
): Promise<KillSwitchActionResult> {
  const actorResolution = await resolveActorOrRefusal();
  if (!actorResolution.ok) {
    return { ok: false, error: actorResolution.error };
  }
  const operatorActor = actorResolution.actor;

  const res = await fetch(`${API_BASE}/api/discord/kill-switch`, {
    method: 'POST',
    headers: resolveCommandCenterApiHeaders(),
    body: JSON.stringify({ target, killed, reason, actor: operatorActor }),
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
