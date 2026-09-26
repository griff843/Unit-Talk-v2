# PROOF: WORK-2026092502

MERGE_SHA: pending merge

> Pre-merge, the merge row is intentionally a placeholder. The Execution SHA row carries the last commit on this lane that changes
> anything outside `docs/06_status/proof/WORK-2026092502/` and the lane manifest.
> `post-merge-lane-close.yml` rebinds merge authority only after GitHub supplies the merged-PR
> attestation.

Generated at: 2026-09-25T20:35:57.000Z
Issue: WORK-2026092502
Tier: T1
Lane type: governance
Branch: claude/work-2026092502-warehouse-historical-backfill
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1650
Head SHA: 3bf6d10c9f087823b45633b1c10109465c2bc1e0
result: pass

## ASSERTIONS:

- [x] `DEFAULT_RETENTION_POLICY` produces a valid object key: `season: 'window-year'` resolves to
      the window's own year. A target whose key cannot be built is a failed window with a
      heartbeat, not a throw that escapes `runConveyor`.
- [x] A `pruneHold` source is archived and verified, and its result never reports
      prune-eligible: on a fresh archive, on a verified skip, or through
      `decideRetentionEligibility` at any future date. `decideRetentionEligibility` deletes nothing.
- [x] `planBackfill` refuses a backwards range, non-ISO bounds, more than 62 windows or the caller's
      cap, and a window still inside hot retention. Windows are planned oldest first, one UTC day each.
- [x] `runBackfill` runs each window through `runConveyor`, stops at the first failed window (the
      next one is never exported), skips verified windows on a re-run, re-exports an interrupted
      upload, treats an unparseable or non-passing manifest as absent, and archives an empty day as
      a verified zero-row object.
- [x] History and quarantine keys never collide; the quarantine is filed under
      `raw/provider_offers_legacy/` and is the only held source.
- [x] `query` and `doctor --research` resolve only the reader key names and refuse to start beside
      the writer key, the source DSN, or a production credential, naming each variable and never
      its value.
- [x] The workflow's backfill job runs only on a `workflow_dispatch` with `mode: backfill`, never on
      the schedule; both jobs run in `warehouse-archive` and refuse off `refs/heads/main`; dispatch
      inputs reach the shell only through env; no job runs a prune or delete.
- [x] `package.json` is not changed. The backfill tests live in `conveyor.test.ts`, already in `test:ops`.
- [x] No secret, GitHub environment, bucket or credential was created or changed. Nothing was
      archived. No production statement was issued.

## EVIDENCE:

Measured at `3bf6d10c9f087823b45633b1c10109465c2bc1e0` in the lane worktree.

```
$ pnpm exec tsx --test scripts/warehouse/*.test.ts
# tests 150
# pass 150
# fail 0

$ pnpm type-check
rc=0

$ pnpm exec eslint scripts/warehouse/*.ts
rc=0

$ pnpm test
# tests 6904
# pass 6904
# fail 0
rc=0

$ pnpm exec tsx scripts/ci/r-level-check.ts --issue WORK-2026092502 --base origin/main --head 3bf6d10c9f087823b45633b1c10109465c2bc1e0
Verdict: PASS
Changed files: 15
Rules matched: (none) — no R-level artifacts required for this diff
```

`pnpm test` was measured at `7d3ee96f0bfd8bbad7e45598caa92980eb762587`; `3bf6d10c9f087823b45633b1c10109465c2bc1e0` adds only
assertions inside one existing test in `scripts/warehouse/conveyor.test.ts`, re-run above.

Mutation battery. Each mutation was applied alone, the four affected suites
(`conveyor`, `conveyor-workflow`, `config`, `query`) were run, and the file was restored from a
pre-mutation copy:

| # | Mutation | Observed |
|---|---|---|
| M1 | `runBackfill` does not stop after a failed window | red: stop on first failure |
| M2 | fresh-archive result ignores `pruneHold` | red: pruneHold never prune-eligible (survived before `3bf6d10c9f087823b45633b1c10109465c2bc1e0`, which added the assertion) |
| M3 | `decideRetentionEligibility` ignores `pruneHold` | red: 2 tests |
| M4 | `'window-year'` passed through verbatim as the season | red: 18 tests |
| M5 | research environment never refuses | red: 2 tests |
| M6 | research store resolves the writer key names | red: 3 tests |
| M7 | the window cap is not enforced | red: 2 tests |
| M8 | backfill job reachable from the schedule | red: backfill is a manual dispatch mode |
| M9 | backfill job outside the `warehouse-archive` environment | red: environment and ref guard |

Restore check: 150/150.

## Verification
- [x] `pnpm type-check`: rc=0
- [x] `pnpm test`: 6904 passed, 0 failed
- [x] `pnpm verify`: not claimed locally. `scripts/ci/assert-staging-target.ts` refuses the
      containment placeholder target by design. The lane manifest records
      `t1_live_db_precondition: deferred_to_ci`, so `verify` and `Writable DB proof (staging only)`
      come from CI on this PR and on the merge SHA.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --issue WORK-2026092502 --base origin/main --head 3bf6d10c9f087823b45633b1c10109465c2bc1e0`: PASS, 15 changed files, no R-level artifacts required

## Runtime Verification

The backfill and conveyor tests are execution proofs, not text checks. They run the real
`runBackfill` / `runConveyor` against an in-process DuckDB source and an in-memory object store,
export real Parquet, and verify each object by reading it back from the store. The CLI tests spawn
`scripts/warehouse/cli.ts` as a child process (`backfill --dry-run`, `query`,
`doctor --research`) with a controlled environment and assert exit status and stdout, including
that no secret value is printed.

No production database, bucket or credential was touched to produce this proof. Starting a
production backfill remains PM-reserved (`WAREHOUSE_HISTORICAL_BACKFILL_PLAN.md` §5).

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1650
Execution SHA: 3bf6d10c9f087823b45633b1c10109465c2bc1e0

Execution anchor: `3bf6d10c9f087823b45633b1c10109465c2bc1e0` is the last implementation commit on this lane. The lane's
implementation is `7d3ee96f0bfd8bbad7e45598caa92980eb762587` and `3bf6d10c9f087823b45633b1c10109465c2bc1e0`, on top of the lane-start
commit whose parent is `origin/main` `d4253e8c59a43c42d9ce31714cbd47030504f660`. The code is the
net diff of local branch `scratch/warehouse-backfill` over `c45679c87`, which on these paths was
identical to `origin/main`; a `package.json` edit and its revert inside that series cancel out.

`work-order.md` in this directory is a byte-identical copy of the repository-owned work order
`.ops/work/WORK-2026092502.md`, which exists only as an uncommitted file.

### Re-anchor to `3bf6d10c9f087823b45633b1c10109465c2bc1e0`

Branch refreshed from origin/main `af2f8e11a` after main advanced. The merge brings in only main's own
changes: `.claude/hooks/tier-c-path-guard.sh`, `.github/workflows/tier-label-apply.yml`, `.github/workflows/tier-label-check.yml`, `.ops/sync/WORK-2026092402.yml`, `.ops/sync/WORK-2026092407.yml`, `.ops/sync/WORK-2026092501.yml`, `.ops/sync/WORK-2026092503.yml`, `.ops/sync/WORK-2026092601.yml`, `.ops/work/WORK-2026092601.md`, `apps/worker/src/runner.ts`, `apps/worker/src/worker-runtime.test.ts`, `docs/05_operations/COMMAND_CENTER_OPERATOR_ACCESS.md`, `docs/06_status/lanes/WORK-2026092402.json`, `docs/06_status/lanes/WORK-2026092407.json`, `docs/06_status/lanes/WORK-2026092501.json`, `docs/06_status/lanes/WORK-2026092503.json`, `docs/06_status/lanes/WORK-2026092601.json`, `docs/06_status/proof/WORK-2026092402/diff-summary.md`, `docs/06_status/proof/WORK-2026092402/evidence.json`, `docs/06_status/proof/WORK-2026092402/verification.md`, `docs/06_status/proof/WORK-2026092402/work-order.md`, `docs/06_status/proof/WORK-2026092407/diff-summary.md`, `docs/06_status/proof/WORK-2026092407/evidence.json`, `docs/06_status/proof/WORK-2026092407/verification.md`, `docs/06_status/proof/WORK-2026092407/work-order.md`, `docs/06_status/proof/WORK-2026092501/diff-summary.md`, `docs/06_status/proof/WORK-2026092501/verification.md`, `docs/06_status/proof/WORK-2026092501/work-order.md`, `docs/06_status/proof/WORK-2026092503/diff-summary.md`, `docs/06_status/proof/WORK-2026092503/evidence.json`, `docs/06_status/proof/WORK-2026092503/verification.md`, `docs/06_status/proof/WORK-2026092503/work-order.md`, `docs/06_status/readiness/readiness-score.json`, `package.json`, `scripts/ci/tier-label-workflow.test.ts`, `scripts/ops/command-center-bridge.test.ts`, `scripts/ops/command-center-bridge.ts`, `scripts/ops/workflow-hardening.test.ts`. Lane-scope files changed by the merge: 0. Superseded anchor, not
withdrawn: `b9240a12cf4dd1badf1785e963135947e2c75fde`. `verify` re-runs on the new head.

### Re-anchor to `3bf6d10c9f087823b45633b1c10109465c2bc1e0`

Branch refreshed from origin/main `0a6690bc6` after main advanced. The merge brings in only main's own
changes: `docs/06_status/readiness/readiness-score.json`. Lane-scope files changed by the merge: 0. Superseded anchor, not
withdrawn: `aec22b93f00e3ff0d573a16a83f19f8c195edfb3`. `verify` re-runs on the new head.

### Re-anchor to `3bf6d10c9f087823b45633b1c10109465c2bc1e0`

Branch refreshed from origin/main `e019642a8` after main advanced. The merge brings in only main's own
changes: `.ops/sync/WORK-2026092602.yml`, `apps/api/src/t1-proof-atomicity.test.ts`, `docs/06_status/lanes/WORK-2026092602.json`, `docs/06_status/proof/WORK-2026092602/diff-summary.md`, `docs/06_status/proof/WORK-2026092602/evidence.json`, `docs/06_status/proof/WORK-2026092602/verification.md`, `scripts/ci/seed-staging-fixtures.ts`, `scripts/ci/staging-board-drain.ts`, `scripts/ci/staging-path-enforcement.test.ts`. Lane-scope files changed by the merge: 0. Superseded anchor, not
withdrawn: `629b27507f5219ee75062dcd88089d84f951ea3e`. `verify` re-runs on the new head.

### Re-anchor to `3bf6d10c9f087823b45633b1c10109465c2bc1e0`

Branch refreshed from origin/main `1526f7e2d` after main advanced. The merge brings in only main's own
changes: `.ops/sync/WORK-2026092603.yml`, `.ops/work/WORK-2026092603.md`, `docs/06_status/lanes/WORK-2026092602.json`, `docs/06_status/lanes/WORK-2026092603.json`. Lane-scope files changed by the merge: 0. Superseded anchor, not
withdrawn: `3762b81d648a7790fdcd97045c338fc09d12c36e`. `verify` re-runs on the new head.

### Re-anchor to `3bf6d10c9f087823b45633b1c10109465c2bc1e0`

Branch refreshed from origin/main `7771bd2d6` after main advanced. The merge brings in only main's own
changes: `.ops/sync/WORK-2026092604.yml`, `.ops/work/WORK-2026092604.md`, `docs/06_status/lanes/WORK-2026092602.json`, `docs/06_status/lanes/WORK-2026092604.json`, `docs/06_status/proof/WORK-2026092602/diff-summary.md`, `docs/06_status/proof/WORK-2026092602/evidence.json`, `docs/06_status/proof/WORK-2026092602/verification.md`. Lane-scope files changed by the merge: 0. Superseded anchor, not
withdrawn: `c4f3c13305b95252f56a4072417278e015076c11`. `verify` re-runs on the new head.

### Re-anchor to `3bf6d10c9f087823b45633b1c10109465c2bc1e0`

Branch refreshed from origin/main `744ff2f6a` after main advanced. The merge brings in only main's own
changes: `docs/06_status/readiness/readiness-score.json`. Lane-scope files changed by the merge: 0. Superseded anchor, not
withdrawn: `3bb2a0a0368d96353722879bbff5d613451e8855`. `verify` re-runs on the new head.
