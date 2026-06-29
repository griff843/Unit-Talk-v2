# UTV2-1353 Verification

## Verification

Run date: 2026-06-28

| Command | Result | Notes |
| --- | --- | --- |
| `pnpm type-check` | PASS | TypeScript project references completed with exit code 0. |
| `pnpm test` | PASS | Root aggregate test suite completed with exit code 0. |
| `git diff --check origin/main...HEAD` | PASS | No whitespace errors reported. |
| R-level lookup | PASS | No matching R-level runtime paths for this metadata/proof-only diff. |
| `pnpm verify` | FAIL | Fails in live DB proof `apps/api/src/t1-proof-utv2-1018-stranded-picks.test.ts` due Supabase statement timeouts during promotion evaluation. |
| `npx tsx --test apps/api/src/t1-proof-utv2-1018-stranded-picks.test.ts` | FAIL | Focused rerun reproduced the statement timeout failure in 2 of 4 subtests. |
| `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS | Final run passed with 4 changed files and no matched R-level rules. |

## Issue-specific verification

- Confirmed branch: `codex/utv2-1353-m1-db-finalization-rollup`.
- Confirmed expected proof paths in `docs/06_status/lanes/UTV2-1353.json`:
  - `docs/06_status/proof/UTV2-1353/diff-summary.md`
  - `docs/06_status/proof/UTV2-1353/verification.md`
- Confirmed changed files are lane metadata and proof artifacts only.

## pnpm test:db TAP output

`pnpm test:db` ran against live Supabase as part of `pnpm verify`. All 7 subtests passed (run completed before the unrelated downstream proof file failure).

```
TAP version 13
# Subtest: database smoke tests
ok 1 - can connect to Supabase
ok 2 - settlement_records table accessible
ok 3 - picks table accessible
ok 4 - system_runs table accessible
ok 5 - provider_offer_history table accessible
ok 6 - outbox table accessible
ok 7 - can read recent records
1..7
# tests 7
# pass 7
# fail 0
# skipped 0
```

## Notes

`pnpm verify` first failed earlier in `scripts/codex-receive.test.ts` because a local fixture branch name already existed; a focused rerun of `npx tsx --test scripts/codex-receive.test.ts` passed. The subsequent full `pnpm verify` progressed through lint, type-check, build, root tests, smart-form verification, command verification, `pnpm test:db`, and several live T1 proof files before failing in `apps/api/src/t1-proof-utv2-1018-stranded-picks.test.ts`.

The reproduced blocker is outside the proof-only file scope for UTV2-1353. No runtime, repository, DB, or migration files were changed from this lane.
