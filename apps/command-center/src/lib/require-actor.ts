import {
  PrivilegedAccessDeniedError,
  assertPrivilegedRequestAuthenticated,
} from './request-auth';
import type { CommandCenterAuthMethod } from './server-api';

export const UNAUTHENTICATED_ACTION_ERROR =
  'Unauthenticated: valid Command Center credentials are required';

export type ActorResolution =
  | { ok: true; actor: string; method: CommandCenterAuthMethod }
  | { ok: false; error: string };

/** Resolve the actor proven by the current request's credentials, or throw. */
export async function requireAuthenticatedActor(): Promise<string> {
  return (await assertPrivilegedRequestAuthenticated()).actor;
}

/** Server-action form of the request-credential assertion. */
export async function resolveActorOrRefusal(): Promise<ActorResolution> {
  try {
    const auth = await assertPrivilegedRequestAuthenticated();
    return { ok: true, actor: auth.actor, method: auth.method };
  } catch (error) {
    if (error instanceof PrivilegedAccessDeniedError) {
      return { ok: false, error: UNAUTHENTICATED_ACTION_ERROR };
    }
    throw error;
  }
}
