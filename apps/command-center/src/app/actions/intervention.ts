'use server';

import { revalidatePath } from 'next/cache';
import {
  resolveApiBaseUrl,
  resolveCommandCenterApiHeaders,
} from '@/lib/server-api';
import { resolveActorOrRefusal } from '@/lib/require-actor';

export type InterventionResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

const API_BASE = resolveApiBaseUrl();

function authHeaders(): Record<string, string> {
  return resolveCommandCenterApiHeaders();
}

export async function retryDelivery(pickId: string, reason: string): Promise<InterventionResult> {
  const actorResolution = await resolveActorOrRefusal();
  if (!actorResolution.ok) {
    return { ok: false, error: actorResolution.error };
  }
  const operatorActor = actorResolution.actor;

  const res = await fetch(`${API_BASE}/api/picks/${pickId}/retry-delivery`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ reason, actor: operatorActor }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: (body as { error?: { message?: string } }).error?.message ?? `Error ${res.status}` };
  revalidatePath('/exceptions');
  revalidatePath(`/picks/${pickId}`);
  return { ok: true, data: (body as { data?: Record<string, unknown> }).data ?? {} };
}

export async function rerunPromotion(pickId: string, reason: string): Promise<InterventionResult> {
  const actorResolution = await resolveActorOrRefusal();
  if (!actorResolution.ok) {
    return { ok: false, error: actorResolution.error };
  }
  const operatorActor = actorResolution.actor;

  const res = await fetch(`${API_BASE}/api/picks/${pickId}/rerun-promotion`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ reason, actor: operatorActor }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: (body as { error?: { message?: string } }).error?.message ?? `Error ${res.status}` };
  revalidatePath('/exceptions');
  revalidatePath(`/picks/${pickId}`);
  return { ok: true, data: (body as { data?: Record<string, unknown> }).data ?? {} };
}

export async function overridePromotion(
  pickId: string,
  action: 'force_promote' | 'suppress',
  reason: string,
  target?: string,
): Promise<InterventionResult> {
  const actorResolution = await resolveActorOrRefusal();
  if (!actorResolution.ok) {
    return { ok: false, error: actorResolution.error };
  }
  const operatorActor = actorResolution.actor;

  const res = await fetch(`${API_BASE}/api/picks/${pickId}/override-promotion`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ action, reason, actor: operatorActor, target }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: (body as { error?: { message?: string } }).error?.message ?? `Error ${res.status}` };
  revalidatePath('/exceptions');
  revalidatePath(`/picks/${pickId}`);
  return { ok: true, data: (body as { data?: Record<string, unknown> }).data ?? {} };
}

export async function requeueDelivery(pickId: string): Promise<InterventionResult> {
  const actorResolution = await resolveActorOrRefusal();
  if (!actorResolution.ok) {
    return { ok: false, error: actorResolution.error };
  }

  const res = await fetch(`${API_BASE}/api/picks/${pickId}/requeue`, {
    method: 'POST',
    headers: authHeaders(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: (body as { error?: { message?: string } }).error?.message ?? `Error ${res.status}` };
  revalidatePath('/exceptions');
  revalidatePath(`/picks/${pickId}`);
  return { ok: true, data: (body as { data?: Record<string, unknown> }).data ?? {} };
}
