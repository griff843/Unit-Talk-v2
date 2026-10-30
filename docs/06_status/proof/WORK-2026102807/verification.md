# PROOF: WORK-2026102807

MERGE_SHA: pending merge

## ASSERTIONS:

- [x] Unfiltered and filtered pick rows resolve the effective settlement chain tip, including corrections older than their original record.
- [x] Corrected rows show `(corrected)`; unsettled and effective manual-review rows show pending.
- [x] One logical paginated history read per nonempty results page uses only that page's pick IDs, stable exact counts, deterministic ordering and an eight-second request timeout.
- [x] Incomplete, changing, invalid or unavailable histories fail closed. Filter/page disagreements also fail closed.
- [x] Existing result-filter/count assertions remain; operations-home assertions are unchanged.
- [x] Desktop, mobile, keyboard, loading, empty and error observations are recorded in qa-experience-report.md.
- [x] Authentication, Track Only population/cohorts, score validation and append-only writes are unchanged. This lane performed no production writes or deployments.

## EVIDENCE:

## Verification

Verified source: `943303fafeae286863184451f6b23d301990f7c3`.

- Direct focused tests: `pnpm exec tsx --test apps/command-center/src/lib/data/queues-count-relation.test.ts apps/command-center/src/lib/data/operations-home.test.ts`: 19 passed, zero failed.
- `pnpm --filter @unit-talk/command-center type-check`: PASS.
- ESLint on the four scoped files and `git diff --check`: PASS.
- `pnpm --filter @unit-talk/command-center build`: PASS, optimized production build.
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS, operator-ui.
- `pnpm --filter @unit-talk/command-center test` within repository verification: PASS, 738 tests, zero failed (previous lane: 728).
- Repository `pnpm type-check` and `pnpm test`, both executed inside `pnpm verify:static`: PASS. These are the repository-wide commands, in addition to the direct focused tests and app checks above.
- Repository `pnpm verify`: every static stage passed, including lint, type-check, build, repository tests, production-post-migration tests, Smart Form verification and command/migration checks. Its writable database stage then exited 1 because the staging guard refused the loopback target. This is not a green full gate; current-head CI must provide the staging receipt before readiness.
- Direct `pnpm test:db`: staging guard refused the same loopback target; no writable test ran locally. Writable database proof belongs to CI's staging run, not a locally configured production target. See verification-output.txt for genuine command output.

## Required mutation check

The dedicated test `unfiltered corrected pick uses the chain tip instead of the view result` uses a stale view loss, a newer-timestamp original loss, and an older-timestamp correction to win. It also asserts the corrected flag, total and single page-history request.

Temporarily replacing the effective-result mapping with the view's `row.settlement_result` made the direct command below exit nonzero at the new unfiltered assertion: `'loss' !== 'win'`. Restoring the source in a `finally` block made the same command pass. The mutation was not committed.

```text
pnpm exec tsx --test --test-name-pattern="unfiltered corrected pick" apps/command-center/src/lib/data/queues-count-relation.test.ts
Mutation: FAIL as expected, assertion expected win but received loss.
Restored implementation: PASS.
```

Additional tests cover 1,001 history rows over two requests, page-only ID constraints, request timeouts, empty pages without history reads, manual-review correction tips, missing counts, incomplete counts, changing counts, duplicate IDs, missing parents, database errors and filter/page disagreement. Existing later-page capper, count and pending-exclusion assertions remain unchanged.

## Provenance and coordination

Observed session model: gpt-6.1-sol. Reasoning effort is unavailable; it is not inferred from the lane declaration or the user's model selector. The declaration is codex-sol-medium / gpt-6.1-sol / medium under policy 3.0.0. Claude must reconcile the unavailable effort through the supported PM-verdict procedure. No PM approval or routing override is claimed here. Claude owns CI coordination, branch refresh, merge and closeout.
