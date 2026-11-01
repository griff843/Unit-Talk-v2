# PROOF: WORK-2026110101

MERGE_SHA: pending merge

Issue: WORK-2026110101
Tier: T1
Lane type: governance
result: local_static_pass_staging_deferred

## ASSERTIONS:

- [x] A pick whose `status` is `settled` is never selected, even when it has no `settlement_records` row. It is counted once, as `status_settled`, only when no earlier rule already kept it (`reap keeps a pick whose status is settled even with no settlement row`).
- [x] Every live pick DELETE re-asserts `created_at < cutoff` and adds `status <> 'settled'`, so a pick that becomes settled between selection and delete is left alone (`every live pick DELETE re-asserts the cutoff and excludes status settled`). `picks.status` is NOT NULL in `packages/db/src/database.types.ts`, so `neq` cannot drop rows with a null status.
- [x] All earlier reaper guarantees are unchanged: settlement and review exclusions, minimum age, cap, fail-closed reads and the submission re-read. The 51 earlier tests pass unchanged.

## EVIDENCE:

Before and after eligibility. This is read-only SQL against the staging project `xskgrzbteyqdufktjrjx`, on 2026-11-01, at the WORK-2026103009 cutoff `2026-10-24T00:00:00Z`. Each counted pick has no `settlement_records` row and no `pick_reviews` row:

```text
{"aged":172390,"before_option_b":113147,"status_settled_kept":9009,"after_option_b":104138,"total":189319}
```

`before_option_b` equals the WORK-2026103009 workflow dry run (run 41319898348: `"scanned": 172390`, `"selected": 113147`, `by_status.settled: 9009`). `after_option_b` is `113147 - 9009`. Nothing was deleted; this lane ran reads only. A fresh dry run of `staging-fixture-reap.yml` follows merge, and execute is not authorized.

Mutation checks on `86bc6c88b6869bbdf1e05f8728a303a881237741`. Each mutation was applied alone to `scripts/ci/staging-fixture-reap.ts`, then `npx tsx --test scripts/ci/staging-path-enforcement.test.ts` was run, then the file was restored from a copy:

```text
M1  status_settled skip off (`if (false)`)   -> not ok 42  # pass 52  # fail 1
M2  DELETE status filter removed             -> not ok 43  # pass 52  # fail 1
restored                                     -> # pass 53  # fail 0
```

After restoring, `git hash-object scripts/ci/staging-fixture-reap.ts` = `05a3a7fa54afd816de172b54d2566f78657c8d2e`, the blob committed at `86bc6c88b`.

## Verification

Run on `86bc6c88b6869bbdf1e05f8728a303a881237741`:

- [x] `npx tsx --test scripts/ci/staging-path-enforcement.test.ts`: `# tests 53`, `# pass 53`, `# fail 0`.
- [x] `pnpm test`: exit 0, after `pnpm build` (exit 0). Summed node:test totals across all files: `# tests 7765`, `# pass 7752`, `# fail 0`, `# skipped 13`.
- [x] Type-check: `pnpm type-check` does not cover `scripts/`. The two changed files were checked directly with `npx tsc -p <tsconfig extending tsconfig.base.json; module esnext, moduleResolution bundler, @unit-talk/* paths mapped to packages/*/src; files: the two changed scripts/ci files>`. It reports no errors in either file.
- [x] `pnpm ci:db-client-boundary`: `OK: every site is classified and none is reachable from pnpm test`.
- [x] `npx eslint scripts/ci/staging-fixture-reap.ts scripts/ci/staging-path-enforcement.test.ts`: exit 0.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: `Verdict: PASS`, no rules matched.
- [ ] `pnpm verify` and `pnpm test:db` run in protected CI on the PR head; the staging DB receipt is produced there. `pnpm verify` cannot exit 0 locally, because `ci:assert-staging` requires the CI environment.
