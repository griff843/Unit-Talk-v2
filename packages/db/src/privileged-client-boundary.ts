/**
 * UTV2-1628 — the one constructor that may open a database connection.
 *
 * ## What UTV2-1630 left open
 *
 * UTV2-1630 made `pnpm ci:assert-staging` a prerequisite of every writable npm
 * script and stripped production credentials from every PR-triggered workflow.
 * That closed the *invocation* surface. It could not close the *construction*
 * surface: eighty-odd modules called `createClient(SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY)` themselves. Run any of those files directly —
 * `tsx --test apps/api/src/database-smoke.test.ts`, a proof script, an editor's
 * "run file" button — and no npm script, and therefore no prerequisite, is
 * involved at all.
 *
 * A guard attached to the script that *usually* runs the code is a guard on the
 * usual path. This one is attached to the act of opening the connection, so
 * there is no path around it short of importing the driver again — which is
 * exactly what `scripts/ci/privileged-db-client-guard.ts` fails the build for.
 *
 * ## The rule
 *
 * In a RESTRICTED context — the node:test runner, or an explicit
 * `UNIT_TALK_DB_TARGET_POLICY=staging-only` — a connection may only be opened to
 * a target that is positively the approved staging project, or positively
 * loopback. Everything else refuses: production, an unidentified host, a custom
 * domain, a pooler, a tunnel, a blank URL.
 *
 * Outside a restricted context the boundary does not second-guess the operator:
 * production runtime must reach production. It still resolves and records the
 * target so the decision is observable rather than implicit.
 *
 * The asymmetry is deliberate and is the whole design. Making production access
 * conditional on a positive signal would mean a missing environment variable
 * takes production down; making test access conditional on a positive signal
 * means a missing environment variable merely refuses to run. Only one of those
 * fails in a safe direction.
 *
 * ## Role is measured, not declared
 *
 * The caller is not asked whether its key is privileged. Supabase keys carry
 * their own role — legacy keys are JWTs with a `role` claim, current keys are
 * prefixed `sb_secret_` / `sb_publishable_` — so the boundary reads it. A
 * caller that mislabels itself changes nothing, and an unrecognised key shape is
 * treated as privileged rather than as safe.
 *
 * No function here ever puts a key, or any substring of one, into a message,
 * a log line, or an error.
 */
import {
  createClient,
  type SupabaseClient,
  type SupabaseClientOptions,
} from '@supabase/supabase-js';
import {
  CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF,
  EXPECTED_STAGING_SUPABASE_PROJECT_REF,
  extractProjectRefFromUrl,
  isApprovedStagingTarget,
  isLoopbackTarget,
} from './target-identity.js';

// The generated Supabase Database type is still hand-shaped in this repo, so we
// relax the client generic at the boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BoundarySupabaseClient = SupabaseClient<any>;

export type KeyRole = 'service_role' | 'anon' | 'unidentified';

export type TargetKind =
  | 'approved-staging'
  | 'loopback'
  | 'canonical-production'
  | 'other-supabase-project'
  | 'unidentified';

export interface RestrictionContext {
  restricted: boolean;
  /** Human-readable signal that put the process in a restricted context. */
  signal: string;
}

export interface TargetDecision {
  allowed: boolean;
  kind: TargetKind;
  role: KeyRole;
  projectRef: string | null;
  host: string | null;
  restriction: RestrictionContext;
  reason: string;
}

/** Thrown instead of returning a client. Carries identity, never a credential. */
export class PrivilegedTargetRefusedError extends Error {
  readonly decision: TargetDecision;

  constructor(decision: TargetDecision, purpose: string) {
    super(
      `[db-boundary] REFUSED to open a ${decision.role} connection for ${purpose}: ` +
        `${decision.reason} (host=${decision.host ?? 'unparseable'}, ` +
        `ref=${decision.projectRef ?? 'unidentified'}, ` +
        `restricted-by=${decision.restriction.signal}). ` +
        `Writable verification runs against ${EXPECTED_STAGING_SUPABASE_PROJECT_REF} ` +
        'through the staging-ci GitHub environment.',
    );
    this.name = 'PrivilegedTargetRefusedError';
    this.decision = decision;
  }
}

/**
 * Read the role a key actually carries.
 *
 * Legacy Supabase keys are unsigned-at-this-layer JWTs; the payload's `role`
 * claim is what PostgREST will honour, so it is what we read. No signature
 * check is attempted or implied — the value is used only to decide how
 * suspicious to be, and an unreadable key is treated as the dangerous case.
 */
export function classifyKeyRole(key: string | undefined): KeyRole {
  if (!key || !key.trim()) return 'unidentified';
  const trimmed = key.trim();

  if (trimmed.startsWith('sb_secret_')) return 'service_role';
  if (trimmed.startsWith('sb_publishable_')) return 'anon';

  const segments = trimmed.split('.');
  if (segments.length === 3 && segments[1]) {
    try {
      const payload = JSON.parse(
        Buffer.from(segments[1], 'base64url').toString('utf8'),
      ) as { role?: unknown };
      if (payload.role === 'service_role') return 'service_role';
      if (payload.role === 'anon') return 'anon';
    } catch {
      // Fall through to unidentified: an unreadable key is not a safe key.
    }
  }
  return 'unidentified';
}

/**
 * Is this process one where reaching a real remote database is illegitimate?
 *
 * `NODE_TEST_CONTEXT` is set by node:test in every test process it spawns, so
 * it covers `pnpm test`, `pnpm test:db`, `pnpm test:t1-proof:live`, a bare
 * `tsx --test <file>`, and anything a test itself spawns (the variable is
 * inherited by child processes). It is set by the runner, not by us, so a
 * caller cannot forget to set it.
 *
 * `UNIT_TALK_DB_TARGET_POLICY=staging-only` exists for the non-test case: a CI
 * job that wants the same containment for a script invocation.
 */
export function detectRestriction(
  env: NodeJS.ProcessEnv = process.env,
): RestrictionContext {
  const testContext = env['NODE_TEST_CONTEXT'];
  if (testContext && testContext.trim()) {
    return { restricted: true, signal: `NODE_TEST_CONTEXT=${testContext}` };
  }
  if (env['UNIT_TALK_DB_TARGET_POLICY'] === 'staging-only') {
    return { restricted: true, signal: 'UNIT_TALK_DB_TARGET_POLICY=staging-only' };
  }
  if (env['NODE_ENV'] === 'test') {
    return { restricted: true, signal: 'NODE_ENV=test' };
  }
  return { restricted: false, signal: 'none' };
}

export function classifyTarget(url: string | undefined): {
  kind: TargetKind;
  projectRef: string | null;
  host: string | null;
} {
  const { projectRef, host } = extractProjectRefFromUrl(url);
  if (isApprovedStagingTarget(url)) {
    return { kind: 'approved-staging', projectRef, host };
  }
  if (isLoopbackTarget(url)) return { kind: 'loopback', projectRef, host };
  if (projectRef === CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF) {
    return { kind: 'canonical-production', projectRef, host };
  }
  if (projectRef) return { kind: 'other-supabase-project', projectRef, host };
  return { kind: 'unidentified', projectRef, host };
}

export interface TargetRequest {
  url: string | undefined;
  key: string | undefined;
}

export function decideTarget(
  request: TargetRequest,
  env: NodeJS.ProcessEnv = process.env,
): TargetDecision {
  const restriction = detectRestriction(env);
  const role = classifyKeyRole(request.key);
  const { kind, projectRef, host } = classifyTarget(request.url);

  if (!restriction.restricted) {
    return {
      allowed: true,
      kind,
      role,
      projectRef,
      host,
      restriction,
      reason: 'unrestricted context: the operator owns the target',
    };
  }

  if (kind === 'approved-staging') {
    return {
      allowed: true,
      kind,
      role,
      projectRef,
      host,
      restriction,
      reason: `target is the approved staging project ${projectRef}`,
    };
  }
  if (kind === 'loopback') {
    return {
      allowed: true,
      kind,
      role,
      projectRef,
      host,
      restriction,
      reason: 'target is a literal loopback address',
    };
  }

  const reason =
    kind === 'canonical-production'
      ? `target is CANONICAL PRODUCTION ${CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF}`
      : kind === 'other-supabase-project'
        ? `target ${projectRef} is neither the approved staging project nor loopback`
        : 'target identity could not be resolved from its URL, so it is not provably isolated';

  return { allowed: false, kind, role, projectRef, host, restriction, reason };
}

/**
 * Throw unless this process may open a connection to this target.
 *
 * Exported separately from the constructor so a caller that builds its own
 * connection for a non-Supabase driver (`postgres`, `pg`) can assert with the
 * same rule instead of inventing a second one.
 */
export function assertTargetAllowed(
  request: TargetRequest,
  purpose: string,
  env: NodeJS.ProcessEnv = process.env,
): TargetDecision {
  const decision = decideTarget(request, env);
  if (!decision.allowed) throw new PrivilegedTargetRefusedError(decision, purpose);
  return decision;
}

/**
 * The single sanctioned Supabase client constructor.
 *
 * Positional signature matches `createClient` so migrating a call site is a
 * one-token change and cannot silently drop an argument.
 */
export function createPrivilegedClient(
  url: string,
  key: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options?: SupabaseClientOptions<any>,
  purpose = 'supabase client',
): BoundarySupabaseClient {
  assertTargetAllowed({ url, key }, purpose);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createClient<any>(url, key, options);
}

/**
 * Assert a raw Postgres connection string before a non-Supabase driver opens
 * it. Returns the string unchanged so it can wrap the argument in place.
 */
export function assertPostgresConnectionAllowed(
  connectionString: string,
  purpose: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  assertTargetAllowed({ url: connectionString, key: undefined }, purpose, env);
  return connectionString;
}
