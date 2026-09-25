# PROOF: WORK-2026092402

MERGE_SHA: d0c4bbc6cce7c395a88213750cf606327f91fce6

> Pre-merge, the merge row is intentionally a placeholder. The Execution SHA row carries the last commit on this lane that changes
> anything outside `docs/06_status/proof/WORK-2026092402/` and the lane manifest.
> `post-merge-lane-close.yml` rebinds merge authority only after GitHub supplies the merged-PR
> attestation.

Generated at: 2026-09-24T12:53:28.000Z
Issue: WORK-2026092402
Tier: T1
Lane type: governance
Branch: claude/work-2026092402-tier-label-work-identity
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1644
Head SHA: f13271ef5fdcdd0e06c3b6e43c0921b134ccd0e1
result: pass

## ASSERTIONS:

- [x] `tier-label-check.yml` resolves `UTV2-`, `UNI-` and `WORK-` identities from the branch and
      the title, using byte-for-byte the grammar `merge-gate.yml` uses.
- [x] The grammar is bounded at both ends: `homework-123` and `work-123abc` do not resolve.
- [x] Both strict-format validators, in the check and in the privileged apply step, admit `WORK-`
      and refuse `WORK-`, `HOMEWORK-1`, `tier:T1` and a trailing space.
- [x] The tier still comes only from the lane manifest, the `^tier:T[123]$` allowlist is
      unchanged in both workflows, and the `pull_request` job never references the privileged token.
- [x] Live: this PR's own Tier Label Check (run 36001060825) passed with
      `Tier label consistent: tier:T1 mirrors lane manifest for WORK-2026092402`. Before the change,
      62 of the last 62 runs on non-UTV2 branches failed.
- [x] Each property is mutation-proven: each of 4 mutations, applied alone, turns a named test red.

## EVIDENCE:

Measured at `f13271ef5fdcdd0e06c3b6e43c0921b134ccd0e1` in the lane worktree.

```
$ pnpm exec tsx --test scripts/ci/tier-label-workflow.test.ts
# tests 6
# pass 6
# fail 0

$ pnpm type-check
rc=0

$ pnpm exec eslint scripts/ci/tier-label-workflow.test.ts
rc=0

$ pnpm test
# tests 6849
# pass 6849
# fail 0
rc=0

$ pnpm exec tsx scripts/ci/r-level-check.ts --issue WORK-2026092402 --base origin/main --head f13271ef5fdcdd0e06c3b6e43c0921b134ccd0e1
Verdict: PASS
Changed files: 7
Rules matched: (none) — no R-level artifacts required for this diff
```

Mutation battery. Each mutation was applied alone to a workflow file, the suite was run, and the
file was restored from a pre-mutation copy:

| # | Mutation | Observed |
|---|---|---|
| M1 | branch grammar reverted to `(?:utv2\|uni)-\d+` | red: tests 1 and 4 |
| M2 | title grammar unbounded at the end | red: tests 3 and 4 |
| M3 | apply validator reverted to `UTV2\|UNI` | red: test 5 |
| M4 | check validator widened to `\d*` | red: test 5 |

Restore check: 6/6.

## Verification
- [x] `pnpm type-check`: rc=0
- [x] `pnpm test`: 6849 passed, 0 failed
- [x] `pnpm verify`: not claimed locally. `scripts/ci/assert-staging-target.ts` refuses the
      containment placeholder target by design. The lane manifest records
      `t1_live_db_precondition: deferred_to_ci`, so `verify` and `Writable DB proof (staging only)`
      come from CI on this PR and on the merge SHA.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --issue WORK-2026092402 --base origin/main --head f13271ef5fdcdd0e06c3b6e43c0921b134ccd0e1`: PASS, 7 changed files, no R-level artifacts required

## Runtime Verification

`tier-label-workflow.test.ts` is an execution proof of the grammars. It reads the regex literals
out of the committed workflow files, compiles them, and runs them against branch names and titles.
It does not compare against a copy.

The live proof is GitHub's own execution of this PR's workflow copy. `Sync tier label` in run
36001060825 at `f13271ef5fdcdd0e06c3b6e43c0921b134ccd0e1` resolved `WORK-2026092402`, read the lane manifest's tier, and reported the
label consistent. Over the 100 runs before this change, 62 of 62 on non-UTV2 branches had failed
with "No issue ID found in PR branch or title".

## Merge SHA Binding

Merge SHA: d0c4bbc6cce7c395a88213750cf606327f91fce6
PR: https://github.com/griff843/Unit-Talk-v2/pull/1644
Execution SHA: f13271ef5fdcdd0e06c3b6e43c0921b134ccd0e1

Execution anchor: `f13271ef5fdcdd0e06c3b6e43c0921b134ccd0e1` is the only implementation commit on this lane. Its parent is
`origin/main` `decd67afaf99eeb41320c40eca14a9d9e9cf92a6`.

`work-order.md` in this directory is a copy of the repository-owned work order
`.ops/work/WORK-2026092402.md`, which exists only as an uncommitted file. It is kept here because
the lane's own proof directory is the one path that the closeout scope check (S1) and the
file-scope guard both admit without widening `file_scope_lock`.

### Re-anchor to `f13271ef5fdcdd0e06c3b6e43c0921b134ccd0e1`

Branch refreshed from origin/main `2f5c14811` after main advanced. The merge brings in only main's own
changes: `.ops/sync/WORK-2026092308.yml`, `.ops/sync/WORK-2026092311.yml`, `.ops/sync/WORK-2026092312.yml`, `.ops/sync/WORK-2026092313.yml`, `.ops/sync/WORK-2026092314.yml`, `.ops/sync/WORK-2026092405.yml`, `.ops/sync/WORK-2026092406.yml`, `apps/api/src/model-performance-service.test.ts`, `apps/api/src/model-performance-service.ts`, `apps/api/src/t1-proof-utv2-1137-settlement-corrections.test.ts`, `docs/02_architecture/HISTORICAL_MARKET_DATA_WAREHOUSE.md`, `docs/05_operations/SGO_REACTIVATION_GATE.md`, `docs/05_operations/WAREHOUSE_HISTORICAL_BACKFILL_PLAN.md`, `docs/05_operations/WAREHOUSE_OBJECT_STORAGE_PROVISIONING.md`, `docs/06_status/lanes/WORK-2026092308.json`, `docs/06_status/lanes/WORK-2026092311.json`, `docs/06_status/lanes/WORK-2026092312.json`, `docs/06_status/lanes/WORK-2026092313.json`, `docs/06_status/lanes/WORK-2026092314.json`, `docs/06_status/lanes/WORK-2026092405.json`, `docs/06_status/lanes/WORK-2026092406.json`, `docs/06_status/proof/WORK-2026092308/evidence.json`, `docs/06_status/proof/WORK-2026092308/verification.md`, `docs/06_status/proof/WORK-2026092311/diff-summary.md`, `docs/06_status/proof/WORK-2026092311/verification.md`, `docs/06_status/proof/WORK-2026092312/.gitkeep`, `docs/06_status/proof/WORK-2026092312/diff-summary.md`, `docs/06_status/proof/WORK-2026092312/verification.md`, `docs/06_status/proof/WORK-2026092313/diff-summary.md`, `docs/06_status/proof/WORK-2026092313/verification.md`, `docs/06_status/proof/WORK-2026092314/diff-summary.md`, `docs/06_status/proof/WORK-2026092314/verification.md`, `docs/06_status/proof/WORK-2026092405/diff-summary.md`, `docs/06_status/proof/WORK-2026092405/verification.md`, `docs/06_status/proof/WORK-2026092405/work-order.md`, `docs/06_status/proof/WORK-2026092406/diff-summary.md`, `docs/06_status/proof/WORK-2026092406/verification.md`, `docs/06_status/proof/WORK-2026092406/work-order.md`, `docs/06_status/readiness/readiness-score.json`, `docs/mission/plan.md`, `scripts/ops/db-health-checks.ts`, `scripts/ops/db-health-tripwire.ts`, `scripts/ops/readiness-refresh.test.ts`, `scripts/ops/readiness-refresh.ts`, `scripts/ops/workflow-hardening.test.ts`, `scripts/warehouse/conveyor.test.ts`, `scripts/warehouse/query.test.ts`. Lane-scope files changed by the merge: 0. Superseded anchor, not
withdrawn: `baa99d774ee51ff5e1fde07a3066d0667eebee28`. `verify` re-runs on the new head.

### Re-anchor to `f13271ef5fdcdd0e06c3b6e43c0921b134ccd0e1`

Branch refreshed from origin/main `d4253e8c5` after main advanced. The merge brings in only main's own
changes: `.github/workflows/deploy-monitoring.yml`, `.github/workflows/deploy.yml`, `.github/workflows/warehouse-archive-conveyor.yml`, `.ops/sync/WORK-2026092401.yml`, `.ops/sync/WORK-2026092403.yml`, `.ops/sync/WORK-2026092404.yml`, `apps/api/src/fixture-pick.ts`, `apps/api/src/model-health-scanner.ts`, `apps/api/src/routes/health.ts`, `apps/api/src/server.test.ts`, `deploy/production/docker-compose.yml`, `docs/05_operations/WAREHOUSE_ARCHIVE_CONTRACT.md`, `docs/06_status/lanes/WORK-2026092401.json`, `docs/06_status/lanes/WORK-2026092403.json`, `docs/06_status/lanes/WORK-2026092404.json`, `docs/06_status/proof/WORK-2026092401/diff-summary.md`, `docs/06_status/proof/WORK-2026092401/evidence.json`, `docs/06_status/proof/WORK-2026092401/verification.md`, `docs/06_status/proof/WORK-2026092401/work-order.md`, `docs/06_status/proof/WORK-2026092403/diff-summary.md`, `docs/06_status/proof/WORK-2026092403/evidence.json`, `docs/06_status/proof/WORK-2026092403/verification.md`, `docs/06_status/proof/WORK-2026092403/work-order.md`, `docs/06_status/proof/WORK-2026092404/evidence.json`, `docs/06_status/proof/WORK-2026092404/verification.md`, `docs/06_status/proof/WORK-2026092404/work-order.md`, `docs/06_status/readiness/readiness-score.json`, `packages/db/src/repositories.ts`, `packages/db/src/runtime-repositories.ts`, `scripts/ci/deploy-config-rollback.test.ts`, `scripts/warehouse/cli.ts`, `scripts/warehouse/config.test.ts`, `scripts/warehouse/config.ts`, `scripts/warehouse/conveyor-workflow.test.ts`. Lane-scope files changed by the merge: 0. Superseded anchor, not
withdrawn: `e4f99465f4d5c8efc0b458006d21f4cf63df2657`. `verify` re-runs on the new head.

### Re-anchor to `f13271ef5fdcdd0e06c3b6e43c0921b134ccd0e1`

Branch refreshed from origin/main `49ea57e3a` after main advanced. The merge brings in only main's own
changes: `docs/06_status/readiness/readiness-score.json`. Lane-scope files changed by the merge: 0. Superseded anchor, not
withdrawn: `eac8c9d68a32c7787bf7bee8106f83b36a726d0d`. `verify` re-runs on the new head.
