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
 * Deliberately NOT filled in: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
 * `SUPABASE_ANON_KEY`. `packages/db`'s privileged-client boundary refuses to
 * open a connection whose target identity cannot be resolved from its URL, so
 * a placeholder there does not make a test hermetic — it makes it fail on a
 * different line — and a real project ref would point a test at a real
 * database. Connection credentials stay the checkout's to provide.
 */

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
