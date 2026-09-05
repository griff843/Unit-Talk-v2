'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { resolveActorOrRefusal } from '@/lib/require-actor';
import {
  resolveApiBaseUrl,
  resolveCommandCenterApiHeaders,
} from '@/lib/server-api';

type ModelHealthAction = 'acknowledge' | 'demote' | 'retire';

export async function submitModelHealthDecision(formData: FormData) {
  const actorResolution = await resolveActorOrRefusal();
  if (!actorResolution.ok) {
    redirect(`/model-health?error=${encodeURIComponent(actorResolution.error)}`);
  }

  const modelId = String(formData.get('modelId') ?? '').trim();
  const action = String(formData.get('action') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();

  if (!modelId || !isModelHealthAction(action) || !reason) {
    redirect('/model-health?error=Model%20ID%2C%20action%2C%20and%20reason%20are%20required.');
  }

  const res = await fetch(`${resolveApiBaseUrl()}/api/model-health/decision`, {
    method: 'POST',
    headers: resolveCommandCenterApiHeaders(),
    body: JSON.stringify({ modelId, action, reason, actor: actorResolution.actor }),
  });
  const body = await res.json().catch(() => null) as unknown;
  if (!res.ok) {
    const message = readErrorMessage(body) ?? `Model health decision failed: ${res.status}`;
    redirect(`/model-health?error=${encodeURIComponent(message)}`);
  }

  revalidatePath('/model-health');
  redirect('/model-health?decision=recorded');
}

function isModelHealthAction(value: string): value is ModelHealthAction {
  return value === 'acknowledge' || value === 'demote' || value === 'retire';
}

function readErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const error = Reflect.get(value, 'error');
  if (typeof error === 'string') return error;
  if (!error || typeof error !== 'object') return null;
  const message = Reflect.get(error, 'message');
  return typeof message === 'string' ? message : null;
}
