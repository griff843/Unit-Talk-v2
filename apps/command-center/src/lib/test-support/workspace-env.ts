/**
 * Test-only: satisfy the workspace environment `getDataClient` loads.
 *
 * `lib/data/client.ts` calls `loadEnvironment(resolveWorkspaceRoot())`, which
 * walks up from the module for a real monorepo root and throws
 * `Missing required env var: ...` when it does not find one. Any test that
 * constructs the data client therefore passed inside this checkout and failed
 * in a scratch tree — a hermeticity defect, not a behavioural one, but one that
 * makes the control unrunnable anywhere else.
 *
 * These values are placeholders. Nothing here is a credential, and every test
 * that uses them also stubs `fetch`, so no request built from them leaves the
 * process.
 */
const PLACEHOLDERS: Record<string, string> = {
  UNIT_TALK_LEGACY_WORKSPACE: 'test-workspace',
  LINEAR_TEAM_KEY: 'TEST',
  LINEAR_TEAM_NAME: 'Test',
  NOTION_WORKSPACE_NAME: 'test',
  SLACK_WORKSPACE_NAME: 'test',
};

/**
 * Deliberately NOT filled in by `withWorkspaceEnvDefaults`: `SUPABASE_URL`,
 * `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`. An arbitrary placeholder
 * there does not make a test hermetic — `packages/db`'s privileged-client
 * boundary refuses a target whose identity cannot be resolved from its URL, so
 * the test fails on a different line — and a real project ref would point a
 * test at a real database.
 *
 * `withLoopbackSupabaseTarget` below is the supported way to get past that
 * boundary. It is not a placeholder in the same sense: `decideTarget` in
 * `packages/db/src/privileged-client-boundary.ts` classifies a literal loopback
 * address as `loopback` and allows it explicitly, on the grounds that such a
 * target is provably isolated. Nothing there can reach a real database.
 */

const LOOPBACK_SUPABASE_ENV: Record<string, string> = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_ANON_KEY: 'loopback-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'loopback-service-role-key',
};

/**
 * Point the data client at a loopback target for the duration of a test.
 *
 * Unlike `withWorkspaceEnvDefaults` this **overrides** any ambient value rather
 * than filling a gap, so a checkout that happens to carry real Supabase
 * credentials runs the same test against the same isolated target as CI, which
 * carries none. That is the point: without it, these tests passed locally and
 * failed in CI purely on ambient environment.
 *
 * Returns a restore function.
 */
export function withLoopbackSupabaseTarget(): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(LOOPBACK_SUPABASE_ENV)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

/** Fill in only what is missing; returns a restore function. */
export function withWorkspaceEnvDefaults(): () => void {
  const filled: string[] = [];
  for (const [key, value] of Object.entries(PLACEHOLDERS)) {
    if (process.env[key]) continue;
    process.env[key] = value;
    filled.push(key);
  }
  return () => {
    for (const key of filled) delete process.env[key];
  };
}
