'use server';

import { revalidatePath } from 'next/cache';

export type InterventionResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:3000';
const API_KEY = process.env.UNIT_TALK_CC_API_KEY ?? '';
const OPERATOR_ACTOR = process.env.OPERATOR_IDENTITY ?? 'command-center';

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;
  return headers;
}

export async function retryDelivery(pickId: string, reason: string): Promise<InterventionResult> {
  const res = await fetch(`${API_BASE}/api/picks/${pickId}/retry-delivery`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ reason, actor: OPERATOR_ACTOR }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: (body as { error?: { message?: string } }).error?.message ?? `Error ${res.status}` };
  revalidatePath('/exceptions');
  return { ok: true, data: (body as { data?: Record<string, unknown> }).data ?? {} };
}

export async function rerunPromotion(pickId: string, reason: string): Promise<InterventionResult> {
  const res = await fetch(`${API_BASE}/api/picks/${pickId}/rerun-promotion`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ reason, actor: OPERATOR_ACTOR }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: (body as { error?: { message?: string } }).error?.message ?? `Error ${res.status}` };
  revalidatePath('/exceptions');
  return { ok: true, data: (body as { data?: Record<string, unknown> }).data ?? {} };
}

export async function overridePromotion(
  pickId: string,
  action: 'force_promote' | 'suppress',
  reason: string,
  target?: string,
): Promise<InterventionResult> {
  const res = await fetch(`${API_BASE}/api/picks/${pickId}/override-promotion`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ action, reason, actor: OPERATOR_ACTOR, target }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: (body as { error?: { message?: string } }).error?.message ?? `Error ${res.status}` };
  revalidatePath('/exceptions');
  return { ok: true, data: (body as { data?: Record<string, unknown> }).data ?? {} };
}

export async function requeueDelivery(pickId: string): Promise<InterventionResult> {
  const res = await fetch(`${API_BASE}/api/picks/${pickId}/requeue`, {
    method: 'POST',
    headers: authHeaders(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: (body as { error?: { message?: string } }).error?.message ?? `Error ${res.status}` };
  revalidatePath('/exceptions');
  return { ok: true, data: (body as { data?: Record<string, unknown> }).data ?? {} };
}
