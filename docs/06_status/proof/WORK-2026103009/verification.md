# PROOF: WORK-2026103009

MERGE_SHA: pending merge

Issue: WORK-2026103009
Tier: T1
Lane type: governance
result: local_static_pass_staging_deferred

## ASSERTIONS:

- [x] A cutoff younger than 7 days, or an invalid date, is refused (`reap refuses a cutoff younger than the minimum age`).
- [x] Only picks strictly older than the cutoff are selected (`reap selects only rows strictly older than the cutoff`).
- [x] A pick with a settlement or review row is never selected, however old it is (`reap never selects a settled or reviewed pick, however old`).
- [x] A pick whose `created_at` cannot be parsed is skipped, not selected (`reap skips a row whose created_at cannot be parsed`).
- [x] An execute whose selection exceeds `--max-picks` is refused before any delete, and the cap must be a non-negative integer (`reap refuses an execute larger than the reviewed cap`).
- [x] `--execute` requires both `--cutoff` and `--max-picks` (`reap execute requires an explicit cutoff and cap`).
- [x] The default run is a dry run at the minimum age, and unknown flags are refused (`reap defaults to a dry run at the minimum age and rejects unknown flags`).
- [x] The reaper's CLI entrypoint is real-path guarded (`no writable-path script guards its CLI entrypoint by filename`, GUARDED list).
- [x] The workflow binds `staging-ci` for its `CI_SUPABASE_*` secrets and holds no production credential (`scripts/ci/workflow-production-credential-guard.test.ts`, 37/37).

## EVIDENCE:

Dry-run figures, from read-only SQL against staging project `xskgrzbteyqdufktjrjx` on 2026-10-31 (`select count(*) filter (...) from picks p` with `NOT EXISTS` on `settlement_records` and `pick_reviews`, cutoff `2026-10-24T00:00:00Z`):

```text
{"aged":172390,"reapable":113147,"total":186367}
```

Foreign keys into `picks` on staging, from `pg_constraint`:

```text
distribution_outbox     FOREIGN KEY (pick_id) REFERENCES picks(id) ON DELETE CASCADE
pick_lifecycle          FOREIGN KEY (pick_id) REFERENCES picks(id) ON DELETE CASCADE
pick_offer_snapshots    FOREIGN KEY (pick_id) REFERENCES picks(id) ON DELETE CASCADE
pick_promotion_history  FOREIGN KEY (pick_id) REFERENCES picks(id) ON DELETE CASCADE
pick_reviews            FOREIGN KEY (pick_id) REFERENCES picks(id)
settlement_records      FOREIGN KEY (pick_id) REFERENCES picks(id) ON DELETE CASCADE
```

Settled and reviewed picks are excluded, so neither the `settlement_records` cascade nor the `pick_reviews` restriction is reached. This lane deleted nothing; the queries above were reads only.

Mutation checks on `72b91c897879abeedc6a03b587c3a36be00308a9`. Each mutation was applied alone to `scripts/ci/staging-fixture-reap.ts`, then `pnpm exec tsx --test scripts/ci/staging-path-enforcement.test.ts` was run, then the file was restored with `git checkout`:

```text
M1 settled exclusion disabled   -> not ok 41  # fail 1
M2 reviewed exclusion disabled  -> not ok 41  # fail 1
M3 max-picks cap disabled       -> not ok 43  # fail 1
M4 minimum-age check disabled   -> not ok 39, not ok 45  # fail 2
M5 execute-args guard disabled  -> not ok 44  # fail 1
restored                        -> # fail 0
```

After restoring, `git status --short` was empty and `git hash-object scripts/ci/staging-fixture-reap.ts` = `9f5c51c9c1427f81e20235c624d8d32da0105d8c`.

## Verification

Run on `72b91c897879abeedc6a03b587c3a36be00308a9`:

- [x] `pnpm exec tsx --test scripts/ci/staging-path-enforcement.test.ts`: `# tests 46`, `# pass 46`, `# fail 0`, `# skipped 0`.
- [x] `pnpm exec tsx --test scripts/ci/workflow-production-credential-guard.test.ts`: `# tests 37`, `# pass 37`, `# fail 0`, `# skipped 0`.
- [x] `pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts`: `# tests 99`, `# pass 99`, `# fail 0`, `# skipped 0`.
- [x] `pnpm test`: exit 0, after `pnpm build` (exit 0). Summed node:test totals across all files: `# tests 7744`, `# pass 7731`, `# fail 0`, `# skipped 13`. The first `pnpm test` in this fresh worktree ran before any build and failed 133 Command Center tests with `Cannot find module '../../../../../packages/config/dist/env.js'`. None of those tests is in this lane's scope. The rerun after building is the one recorded here.
- [x] `pnpm type-check`: exit 0.
- [x] `pnpm ci:db-client-boundary`: `OK: every site is classified and none is reachable from pnpm test`.
- [x] `pnpm exec eslint scripts/ci/staging-fixture-reap.ts scripts/ci/staging-path-enforcement.test.ts`: exit 0. Repo-wide `pnpm lint` runs in CI.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: `Verdict: PASS`, no rules matched.
- [x] `pnpm ops:preflight WORK-2026103009 --tier T1 --branch claude/work-2026103009-staging-fixture-reap --lane-type governance --refresh` (one `--files` flag per path): `VERDICT: PASS (42 checks)`. PT1 was BLOCKED_BY_CONTAINMENT, admitted under the ratified route B in `docs/governance/PT1_CONTAINMENT_ADMISSION_DECISION.md`.
- [ ] `pnpm verify` in CI on the PR head: pending. CI `verify` is the verification of record.
- [ ] `pnpm test:db`: deferred to the protected `staging-ci` environment inside the required `verify` check.

Runtime: no dispatch of the new workflow has been run. The first runtime evidence is the post-merge `mode=dry-run` dispatch, which is reviewed before any `mode=execute`.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Execution SHA: 72b91c897879abeedc6a03b587c3a36be00308a9
