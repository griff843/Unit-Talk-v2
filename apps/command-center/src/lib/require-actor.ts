import { headers } from 'next/headers';

/**
 * Server-side enforcement that a request actually passed through the
 * authentication middleware.
 *
 * The middleware sets `x-command-center-actor` on every request it admits. Until
 * this module existed nothing read it, so the header was decorative: a request
 * that never reached the middleware was indistinguishable downstream from one
 * that authenticated successfully. That made the matcher the single point of
 * failure — one regex stood between an anonymous caller and server actions that
 * attach the app's own privileged API key.
 *
 * Reading the header here makes the injected identity load-bearing. A request
 * that skipped the middleware carries no actor, so every privileged path below
 * refuses instead of proceeding under a fabricated environment identity.
 *
 * This is defence in depth, not the primary control. The matcher in
 * `middleware.ts` is still what admits requests; this is the second gate that
 * has to fail at the same time for a bypass to reach privileged code.
 */

export const ACTOR_HEADER = 'x-command-center-actor';
export const ROLE_HEADER = 'x-command-center-role';

export const UNAUTHENTICATED_ACTOR_CODE = 'COMMAND_CENTER_ACTOR_MISSING';

export class UnauthenticatedActorError extends Error {
  readonly code = UNAUTHENTICATED_ACTOR_CODE;

  constructor(message = 'Request did not pass Command Center authentication') {
    super(message);
    this.name = 'UnauthenticatedActorError';
  }
}

export interface ReadonlyHeaderBag {
  get(name: string): string | null | undefined;
}

/**
 * Pure form, so the control can be tested — and inverted — without a running
 * Next server.
 *
 * A client cannot forge its way past this on a correctly configured deployment:
 * the middleware rebuilds the request headers and *sets* the actor from the
 * authenticated result, overwriting anything the caller supplied. The value is
 * therefore either middleware-issued or absent.
 */
export function assertAuthenticatedActor(headerBag: ReadonlyHeaderBag): string {
  const actor = headerBag.get(ACTOR_HEADER)?.trim();

  if (!actor) {
    throw new UnauthenticatedActorError();
  }

  return actor;
}

/** Resolve the authenticated actor for the current request, or refuse. */
export async function requireAuthenticatedActor(): Promise<string> {
  return assertAuthenticatedActor(await headers());
}

/** The authenticated role, when a caller needs it. Absent role is not fatal. */
export async function currentActorRole(): Promise<string | null> {
  return (await headers()).get(ROLE_HEADER)?.trim() ?? null;
}

export const UNAUTHENTICATED_ACTION_ERROR =
  'Unauthenticated: request did not pass Command Center authentication';

export type ActorResolution =
  | { ok: true; actor: string }
  | { ok: false; error: string };

/**
 * Server-action form. Every privileged action already returns an
 * `{ ok: false, error }` union, so a refusal is reported the same way an API
 * failure is rather than surfacing as an unhandled 500.
 */
export async function resolveActorOrRefusal(): Promise<ActorResolution> {
  try {
    return { ok: true, actor: await requireAuthenticatedActor() };
  } catch (error) {
    if (error instanceof UnauthenticatedActorError) {
      return { ok: false, error: UNAUTHENTICATED_ACTION_ERROR };
    }
    throw error;
  }
}
