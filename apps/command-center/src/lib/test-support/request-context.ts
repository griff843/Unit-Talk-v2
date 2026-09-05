/**
 * Test-only helper: run a function inside a Next request context whose sealed
 * headers carry exactly the entries given.
 *
 * Sealing an EMPTY header bag is what let the original CVE survive a green
 * suite: no test ever placed a forged `x-command-center-actor` header in the
 * request the guard actually reads. Callers must be able to supply headers.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestStore } from 'next/dist/server/app-render/work-unit-async-storage.external';
import type { WorkStore } from 'next/dist/server/app-render/work-async-storage.external';

const runtime = globalThis as typeof globalThis & {
  AsyncLocalStorage: typeof AsyncLocalStorage;
};
runtime.AsyncLocalStorage = AsyncLocalStorage;

export type HeaderEntries = Record<string, string>;

/** Headers a caller can forge for free: derived identity, never credentials. */
export const FORGED_IDENTITY_HEADERS: HeaderEntries = {
  'x-command-center-actor': 'attacker',
  'x-command-center-role': 'operator',
};

/**
 * A forged actor value distinctive enough to be searched for verbatim in an
 * outbound request.
 *
 * The unauthenticated cases above only prove a request is refused. They cannot
 * see an action that calls the guard correctly and then overwrites the actor it
 * records with `x-command-center-actor`. Because `COMMAND_CENTER_AUTH_TOKEN` is
 * one shared bearer, the recorded actor is the only thing distinguishing
 * operators, so an authenticated caller forging this header is the whole
 * audit-integrity question.
 */
export const FORGED_ACTOR_SENTINEL = 'forged-actor-sentinel-must-never-be-recorded';

/** Identity headers an *authenticated* caller can still forge for free. */
export const FORGED_AUTHENTICATED_IDENTITY_HEADERS: HeaderEntries = {
  'x-command-center-actor': FORGED_ACTOR_SENTINEL,
  // Every forgeable value here must carry the sentinel, including ones that are
  // not identities. `role` was previously a bare 'admin', which no assertion
  // could distinguish from a legitimate value: an action could forward a
  // caller-supplied *authority* claim to the backend alongside a correctly
  // recorded actor, and the suite stayed green. The forged-actor assertion pins
  // identity; the sentinel is what makes any forwarded caller-supplied value
  // detectable at all.
  'x-command-center-role': `admin-${FORGED_ACTOR_SENTINEL}`,
  'x-forwarded-user': FORGED_ACTOR_SENTINEL,
};

export async function withRequestContext<T>(
  headerEntries: HeaderEntries,
  fn: () => T,
): Promise<T> {
  const [unitStorage, workStorage, adapter] = await Promise.all([
    import('next/dist/server/app-render/work-unit-async-storage.external'),
    import('next/dist/server/app-render/work-async-storage.external'),
    import('next/dist/server/web/spec-extension/adapters/headers'),
  ]);
  const requestStore = {
    type: 'request',
    phase: 'action',
    headers: adapter.HeadersAdapter.seal(new Headers(headerEntries)),
  } as RequestStore;
  const workStore = {
    isStaticGeneration: false,
    page: '/test/page',
    route: '/test',
  } as WorkStore;
  return workStorage.workAsyncStorage.run(
    workStore,
    () => unitStorage.workUnitAsyncStorage.run(requestStore, fn),
  );
}
