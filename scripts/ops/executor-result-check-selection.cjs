'use strict';

// UTV2-1573: pure selection logic for the exact-head `verify` check run,
// extracted so executor-result-validator.yml's actions/github-script step
// can `require()` it directly (no build step) and so the actual
// newest-wins / wrong-app-ignored / fail-closed semantics are covered by a
// real regression test instead of only exercised live. Companion to
// scripts/ops/merge-gate-verdict.cjs -- same pattern, same reason: a
// github-script `script:` block is a YAML string, not a unit-testable
// function, so any logic worth asserting against specific inputs has to
// live in a plain CommonJS module the step can require() at runtime.
//
// This module does no fetching or pagination itself -- the caller is
// responsible for collecting the FULL set of check-runs for a commit
// (e.g. via `github.paginate(github.rest.checks.listForRef, { ... })`,
// which pages past GitHub's 30-per-page default with no upper bound) and
// passes that complete array in here.

const GITHUB_ACTIONS_APP_SLUG = 'github-actions';
const VERIFY_CHECK_NAME = 'verify';

/**
 * From the full set of check-runs for a commit, selects the newest
 * github-actions-run `verify` check-run. Returns null if none match.
 *
 * "Newest" is decided by check-run `id` (monotonically assigned by GitHub
 * at creation), not `started_at` -- id ordering is exact and collision-free,
 * where two runs created within the same second would tie on a timestamp.
 *
 * Deliberately does not filter by status/conclusion: if the newest matching
 * run is incomplete or failed, callers must see that run (and fail closed
 * accordingly) rather than silently falling back to an older successful one.
 */
function selectLatestVerifyCheckRun(checkRuns) {
  const candidates = (checkRuns || []).filter(
    (run) => run && run.name === VERIFY_CHECK_NAME && run.app && run.app.slug === GITHUB_ACTIONS_APP_SLUG,
  );
  if (candidates.length === 0) {
    return null;
  }

  return candidates.reduce((latest, run) => (run.id > latest.id ? run : latest));
}

module.exports = {
  selectLatestVerifyCheckRun,
  VERIFY_CHECK_NAME,
  GITHUB_ACTIONS_APP_SLUG,
};
