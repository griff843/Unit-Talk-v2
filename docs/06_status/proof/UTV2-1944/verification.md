# PROOF: UTV2-1944

Execution SHA: `81683c655b1ba018fef1f7579230b2ab4d020484`
Merge SHA: pending merge

## Verification

- `pnpm type-check` — PASS
- `pnpm build` — PASS
- `pnpm exec tsx --test apps/command-center/src/lib/governed-population.test.ts` — PASS (4/4)
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS; matched `operator-ui` with no required artifacts.
- `pnpm test` and `pnpm verify:static` were started after the implementation commit and were still executing the repository-wide API suite at closeout capture time. Their outcome must be read from the completed local process / PR checks.

The focused test verifies positive membership, the default governed selection, the labelled fixture selection, and that discovery plus analytics import the one predicate instead of restating it.

## Live DB evidence

No writable live-DB action was performed. Per the work packet: writable live-DB proof is blocked/deferred because the target identity cannot be resolved from its URL (`host=unparseable`); it requires `xskgrzbteyqdufktjrjx` through the `staging-ci` GitHub environment with `CI_SUPABASE_*` credentials.

The supplied production read-only baseline remains: `picks` = 107866 and positive `metadata ? 'distributionMode'` cohort = 8. The deployed query must be run through that allowlisted environment to record the post-deploy count and settlement reconciliation.
