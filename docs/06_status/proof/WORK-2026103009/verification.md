# PROOF: WORK-2026103009

MERGE_SHA: 21d4b26fd60bd6991d3e1e8c8b6fccfab83587e9

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
- [x] A submission whose retained picks sort past the 1,000-row response cap is kept, and every retained pick keeps its `submission_id` after an execute (`reap keeps a submission whose retained picks sit past the 1,000-row cap, and never nulls their link`).
- [x] A settled pick whose settlement row sorts past the 1,000-row cap is never selected (`reap never selects a settled pick whose settlement row sits past the 1,000-row cap`).
- [x] Every read fails closed on a shortfall, a changed count, a missing count or a repeated row, and a failed read aborts an execute before anything is deleted (`reap fails closed on an incomplete, changed, uncounted or repeating read`).
- [x] Each orphaned-submission batch is re-read before its DELETE, and a submission that gained a linking pick is kept (`reap re-reads each submission batch before deleting it and keeps one that gained a pick`).
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

Correction after the PM T1 review of #1813 (CHANGES REQUIRED at `1013741c2`): the picks-by-submission, settlement and review lookups were single `.in()` requests that PostgREST caps at 1,000 rows. They, and the aged-row scans, now go through `readAllVerified`. The adversarial tests run `reapStagingFixtures` end to end against an in-memory `ReapStore` that returns at most 1,000 rows per response and applies `ON DELETE SET NULL` to `picks.submission_id`.

Mutation checks on `a0d37b760db24646c36bea6515001150d4ce7292`. Each mutation was applied alone to `scripts/ci/staging-fixture-reap.ts`, then `pnpm exec tsx --test scripts/ci/staging-path-enforcement.test.ts` was run, then the file was restored:

```text
M1  settled exclusion off                -> not ok 41, 47, 48, 50  # fail 4
M2  reviewed exclusion off               -> not ok 41              # fail 1
M3  max-picks cap off                    -> not ok 43              # fail 1
M4  minimum-age check off                -> not ok 39, 45          # fail 2
M5  execute-args guard off               -> not ok 44              # fail 1
M6  linked-picks read unpaged            -> not ok 47, 50          # fail 2
M7  settlement/review read unpaged       -> not ok 48              # fail 1
M8  incomplete-read check off            -> not ok 49              # fail 1
M9  changed-view check off               -> not ok 49              # fail 1
M10 missing-count check off              -> not ok 49              # fail 1
M11 duplicate-row check off              -> not ok 49              # fail 1
M12 pre-delete submission re-read off    -> not ok 50              # fail 1
restored                                 -> # fail 0
```

M6 is the case the review names: with the linked-picks lookup unpaged, test 47 fails because the over-cap submission is deleted and its 100 retained picks have `submission_id` nulled.

After restoring, `git hash-object scripts/ci/staging-fixture-reap.ts` = `0e8641af5060d018bda35e0198923d37c99fc473`, the blob committed at `a0d37b760db24646c36bea6515001150d4ce7292`.

## Verification

Run on `a0d37b760db24646c36bea6515001150d4ce7292`:

- [x] `pnpm exec tsx --test scripts/ci/staging-path-enforcement.test.ts`: `# tests 51`, `# pass 51`, `# fail 0`, `# skipped 0`.
- [x] `pnpm test`: exit 0, after `pnpm build` (exit 0). Summed node:test totals across all files: `# tests 7749`, `# pass 7736`, `# fail 0`, `# skipped 13`.
- [x] Type-check: `pnpm type-check` builds only the `packages/*` and `apps/*` project references and does not cover `scripts/`, so the earlier "type-check PASS" for this lane said nothing about the reaper. The changed files were checked directly with `npx tsc -p <tsconfig extending tsconfig.base.json, files: scripts/ci/staging-fixture-reap.ts, scripts/ci/staging-path-enforcement.test.ts>`: no errors in either file other than TS1470 (`import.meta` under the ad hoc config's CommonJS default), which does not apply under `tsx`. That check found two `exactOptionalPropertyTypes` errors in code unchanged since the first revision (`ReapArgs`, `reapStagingFixtures` options); both were fixed.
- [x] `pnpm ci:db-client-boundary`: `OK: every site is classified and none is reachable from pnpm test`.
- [x] `pnpm exec eslint scripts/ci/staging-fixture-reap.ts`: exit 0. Repo-wide `pnpm lint` runs in CI.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: `Verdict: PASS`, no rules matched.
- [x] `pnpm ops:preflight WORK-2026103009 --tier T1 --branch claude/work-2026103009-staging-fixture-reap --lane-type governance --refresh` (one `--files` flag per path): `VERDICT: PASS (42 checks)` at admission. PT1 was BLOCKED_BY_CONTAINMENT, admitted under the ratified route B in `docs/governance/PT1_CONTAINMENT_ADMISSION_DECISION.md`.
- [ ] `pnpm verify` in CI on the PR head: pending. CI `verify` is the verification of record.
- [ ] `pnpm test:db`: deferred to the protected `staging-ci` environment inside the required `verify` check.

Runtime: no dispatch of the new workflow has been run. The first runtime evidence is the post-merge `mode=dry-run` dispatch, which is reviewed before any `mode=execute`.

## Merge SHA Binding

Merge SHA: 21d4b26fd60bd6991d3e1e8c8b6fccfab83587e9
PR: https://github.com/griff843/Unit-Talk-v2/pull/1813
Execution SHA: a0d37b760db24646c36bea6515001150d4ce7292
