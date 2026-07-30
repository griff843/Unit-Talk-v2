/**
 * UTV2-1630 — the single gate every writable DB path must pass.
 *
 * ## Why this exists as a script prerequisite rather than a call-site check
 *
 * The isolation guard originally lived inside `ci:db-smoke`. That covered
 * `pnpm test:db` when invoked through `ci:db-smoke` — and nothing else.
 * `verify:live-db-verdict` spawns `test:live-db`, which runs `pnpm test:db`
 * DIRECTLY and then `test:t1-proof:live`, a further 15 writable suites. All of
 * those reached the database without ever passing the guard.
 *
 * That bypass was not theoretical: on 2026-07-30 a pull request wrote 7 picks
 * and 4 submissions to production through exactly this path, while the guard
 * sat in a branch of the call graph nothing took.
 *
 * Making the assertion a prerequisite of the npm scripts themselves means every
 * invocation route — direct, via `test:live-db`, via `verify:live-db-verdict`,
 * or from a developer's shell — hits it first. There is no call site to forget.
 *
 * Refuses unless the resolved target is positively the approved staging project.
 * Unknown, ambiguous, custom-domain, proxy, tunnel, malformed, missing and
 * unresolvable targets all fail, before any client is constructed.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF,
  EXPECTED_STAGING_SUPABASE_PROJECT_REF,
  extractProjectRefFromUrl,
  isApprovedStagingTarget,
} from './isolated-proof-attestation.js';
import { collectEffectiveEnv } from './required-db-smoke.js';

export interface StagingAssertion {
  ok: boolean;
  observedRef: string | null;
  observedHost: string | null;
  reason: string;
}

export function assertStagingTarget(
  env: Record<string, string | undefined>,
): StagingAssertion {
  const url = env['SUPABASE_URL'];
  const { projectRef, host } = extractProjectRefFromUrl(url);

  if (isApprovedStagingTarget(url)) {
    return {
      ok: true,
      observedRef: projectRef,
      observedHost: host,
      reason: `target is the approved staging project ${projectRef}`,
    };
  }

  const detail =
    projectRef === CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF
      ? `target is CANONICAL PRODUCTION ${CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF}`
      : projectRef
        ? `target ${projectRef} is not the approved staging project`
        : `target identity could not be resolved from its URL (host=${host ?? 'unparseable'})`;

  return {
    ok: false,
    observedRef: projectRef,
    observedHost: host,
    reason:
      `${detail}. Writable DB verification requires ${EXPECTED_STAGING_SUPABASE_PROJECT_REF}. ` +
      'Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.',
  };
}

function main(): void {
  const result = assertStagingTarget(collectEffectiveEnv());
  // Identity only — never a credential.
  console.log(
    `[assert-staging] host=${result.observedHost ?? 'unparseable'} ` +
      `ref=${result.observedRef ?? 'unidentified'} expected=${EXPECTED_STAGING_SUPABASE_PROJECT_REF}`,
  );
  if (!result.ok) {
    console.error(`[assert-staging] REFUSED: ${result.reason}`);
    process.exit(1);
  }
  console.log(`[assert-staging] OK: ${result.reason}`);
}

/**
 * Compare resolved real paths rather than matching on filename.
 *
 * An `endsWith('/<name>.ts')` test is defeated by any rename, copy, symlink or
 * compiled .js invocation — and it fails OPEN: main() never runs, the process
 * exits 0, and a `&&` chain proceeds to the writable suite. Verified: a renamed
 * copy of this file exited 0 against a PRODUCTION target while the correctly
 * named file refused with exit 1.
 */
function isCliEntrypoint(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return realpathSync(invoked) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isCliEntrypoint()) {
  main();
}
