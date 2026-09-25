# PROOF: WORK-2026092401

MERGE_SHA: pending merge

> Pre-merge, the merge row is intentionally a placeholder. The Execution SHA row carries the last commit on this lane that changes
> anything outside `docs/06_status/proof/WORK-2026092401/` and the lane manifest.
> `post-merge-lane-close.yml` rebinds merge authority only after GitHub supplies the merged-PR
> attestation.

Generated at: 2026-09-24T12:46:23.000Z
Issue: WORK-2026092401
Tier: T1
Lane type: governance
Branch: claude/work-2026092401-conveyor-unprovisioned-state
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1643
Head SHA: ec8165ec3385ad4caf154e40c6b7a59aa8c36689
result: pass

## ASSERTIONS:

- [x] `describeConfig` reports `archive_state`: `not_provisioned` when no archive key is set,
      `incomplete` when something is set but a key is missing or a placeholder, and `ready`
      only when the object store and the read-only source DSN both resolve.
- [x] A placeholder is never counted as provisioned. A placeholder-only configuration is
      `incomplete`, and a placeholder inside an otherwise complete set is `incomplete`.
- [x] `warehouse doctor` exits 0 only for `ready`. This is proven by spawning the real CLI
      against four configurations and asserting each exit code and `archive_state`. Before this
      change it exited 0 whenever the object store resolved, even with no source DSN.
- [x] Every non-`ready` job summary states that no window was exported, uploaded, verified or
      manifested and that nothing became prune-eligible. No summary and no doctor stdout carries
      a configured value.
- [x] The workflow header no longer claims an unconfigured run "exits cleanly". A test fails if
      it does again.
- [x] No workflow step is added, removed or reordered. The existing "nothing reachable from the
      schedule can delete production data" control still passes.
- [x] Each property is mutation-proven: each of 5 mutations, applied alone, turns a named test red.
- [x] No secret, GitHub environment, bucket or credential was created or changed. Nothing was
      archived. No production statement was issued.

## EVIDENCE:

Measured at `ec8165ec3385ad4caf154e40c6b7a59aa8c36689` in the lane worktree.

```
$ pnpm exec tsx --test scripts/warehouse/config.test.ts scripts/warehouse/conveyor-workflow.test.ts
# tests 26
# pass 26
# fail 0

$ pnpm exec tsx --test scripts/warehouse/*.test.ts
# tests 116
# pass 116
# fail 0

$ pnpm type-check
rc=0

$ pnpm exec eslint scripts/warehouse/config.ts scripts/warehouse/cli.ts scripts/warehouse/config.test.ts scripts/warehouse/conveyor-workflow.test.ts
rc=0

$ pnpm test
# tests 6851
# pass 6851
# fail 0
rc=0

$ pnpm exec tsx scripts/ci/r-level-check.ts --issue WORK-2026092401 --base origin/main --head ec8165ec3385ad4caf154e40c6b7a59aa8c36689
Verdict: PASS
Changed files: 9
Rules matched: (none) — no R-level artifacts required for this diff
```

Mutation battery. Each mutation was applied alone, the two suites were run, and the file was
restored from a pre-mutation copy:

| # | Mutation | Observed |
|---|---|---|
| M1 | `doctor` exits 0 for `not_provisioned` (`archive_state === 'incomplete' ? 1 : 0`) | red: test 26 (doctor exit) |
| M2 | `ready` when every key is merely non-missing, so a placeholder counts | red: tests 12 and 26 |
| M3 | the old exit rule `object_store_ready ? 0 : 1` restored | red: test 26 |
| M4 | the workflow restored to `origin/main` (old header) | red: test 25 (header) |
| M5 | a placeholder-only configuration reads as `not_provisioned` | red: test 12 |

Restore check: 26/26.

## Verification
- [x] `pnpm type-check`: rc=0
- [x] `pnpm test`: 6851 passed, 0 failed
- [x] `pnpm verify`: not claimed locally. `scripts/ci/assert-staging-target.ts` refuses the
      containment placeholder target by design. The lane manifest records
      `t1_live_db_precondition: deferred_to_ci`, so `verify` and `Writable DB proof (staging only)`
      come from CI on this PR and on the merge SHA.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --issue WORK-2026092401 --base origin/main --head ec8165ec3385ad4caf154e40c6b7a59aa8c36689`: PASS, 9 changed files, no R-level artifacts required

## Runtime Verification

The doctor test is an execution proof, not a text check. It spawns `scripts/warehouse/cli.ts
doctor` as a child process with a controlled environment holding only `PATH` plus the
configuration under test, and reads the process exit status and its stdout JSON:

| Configuration | exit | `archive_state` |
|---|---|---|
| nothing set | 1 | `not_provisioned` |
| object store only | 1 | `incomplete` |
| complete set with placeholder bucket | 1 | `incomplete` |
| complete object store + source DSN | 0 | `ready` |

The same run asserts that stdout never contains the secret access key or the DSN password it
was given.

The live evidence this lane corrects is the only scheduled conveyor run, 35980767152
(2026-09-24T09:21Z), which failed at `warehouse doctor` with exit 1 while the header said it
exits cleanly. No production database, bucket or credential was touched to produce this proof.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1643
Execution SHA: ec8165ec3385ad4caf154e40c6b7a59aa8c36689

Execution anchor: `ec8165ec3385ad4caf154e40c6b7a59aa8c36689` is the only implementation commit on this lane. Its parent is
`origin/main` `decd67afaf99eeb41320c40eca14a9d9e9cf92a6`.

`work-order.md` in this directory is a byte-identical copy of the repository-owned work order
`.ops/work/WORK-2026092401.md`, which exists only as an uncommitted file. It is kept here because
the lane's own proof directory is the one path that the closeout scope check (S1) and the
file-scope guard both admit without widening `file_scope_lock`.

### Re-anchor to `ec8165ec3385ad4caf154e40c6b7a59aa8c36689`

Branch refreshed from origin/main `2f5c14811` after main advanced. The merge brings in only main's own
changes: `.ops/sync/WORK-2026092308.yml`, `.ops/sync/WORK-2026092311.yml`, `.ops/sync/WORK-2026092312.yml`, `.ops/sync/WORK-2026092313.yml`, `.ops/sync/WORK-2026092314.yml`, `.ops/sync/WORK-2026092405.yml`, `.ops/sync/WORK-2026092406.yml`, `apps/api/src/model-performance-service.test.ts`, `apps/api/src/model-performance-service.ts`, `apps/api/src/t1-proof-utv2-1137-settlement-corrections.test.ts`, `docs/02_architecture/HISTORICAL_MARKET_DATA_WAREHOUSE.md`, `docs/05_operations/SGO_REACTIVATION_GATE.md`, `docs/05_operations/WAREHOUSE_HISTORICAL_BACKFILL_PLAN.md`, `docs/05_operations/WAREHOUSE_OBJECT_STORAGE_PROVISIONING.md`, `docs/06_status/lanes/WORK-2026092308.json`, `docs/06_status/lanes/WORK-2026092311.json`, `docs/06_status/lanes/WORK-2026092312.json`, `docs/06_status/lanes/WORK-2026092313.json`, `docs/06_status/lanes/WORK-2026092314.json`, `docs/06_status/lanes/WORK-2026092405.json`, `docs/06_status/lanes/WORK-2026092406.json`, `docs/06_status/proof/WORK-2026092308/evidence.json`, `docs/06_status/proof/WORK-2026092308/verification.md`, `docs/06_status/proof/WORK-2026092311/diff-summary.md`, `docs/06_status/proof/WORK-2026092311/verification.md`, `docs/06_status/proof/WORK-2026092312/.gitkeep`, `docs/06_status/proof/WORK-2026092312/diff-summary.md`, `docs/06_status/proof/WORK-2026092312/verification.md`, `docs/06_status/proof/WORK-2026092313/diff-summary.md`, `docs/06_status/proof/WORK-2026092313/verification.md`, `docs/06_status/proof/WORK-2026092314/diff-summary.md`, `docs/06_status/proof/WORK-2026092314/verification.md`, `docs/06_status/proof/WORK-2026092405/diff-summary.md`, `docs/06_status/proof/WORK-2026092405/verification.md`, `docs/06_status/proof/WORK-2026092405/work-order.md`, `docs/06_status/proof/WORK-2026092406/diff-summary.md`, `docs/06_status/proof/WORK-2026092406/verification.md`, `docs/06_status/proof/WORK-2026092406/work-order.md`, `docs/06_status/readiness/readiness-score.json`, `docs/mission/plan.md`, `scripts/ops/db-health-checks.ts`, `scripts/ops/db-health-tripwire.ts`, `scripts/ops/readiness-refresh.test.ts`, `scripts/ops/readiness-refresh.ts`, `scripts/ops/workflow-hardening.test.ts`, `scripts/warehouse/conveyor.test.ts`, `scripts/warehouse/query.test.ts`. Lane-scope files changed by the merge: 0. Superseded anchor, not
withdrawn: `fdacdda21abfc2efef7f0e532f6fb7c9563b19ff`. `verify` re-runs on the new head.

### Re-anchor to `ec8165ec3385ad4caf154e40c6b7a59aa8c36689`

Branch refreshed from origin/main `75800eba9` after main advanced. The merge brings in only main's own
changes: `.github/workflows/deploy-monitoring.yml`, `.github/workflows/deploy.yml`, `.ops/sync/WORK-2026092403.yml`, `.ops/sync/WORK-2026092404.yml`, `apps/api/src/fixture-pick.ts`, `apps/api/src/model-health-scanner.ts`, `apps/api/src/routes/health.ts`, `apps/api/src/server.test.ts`, `deploy/production/docker-compose.yml`, `docs/06_status/lanes/WORK-2026092403.json`, `docs/06_status/lanes/WORK-2026092404.json`, `docs/06_status/proof/WORK-2026092403/diff-summary.md`, `docs/06_status/proof/WORK-2026092403/evidence.json`, `docs/06_status/proof/WORK-2026092403/verification.md`, `docs/06_status/proof/WORK-2026092403/work-order.md`, `docs/06_status/proof/WORK-2026092404/evidence.json`, `docs/06_status/proof/WORK-2026092404/verification.md`, `docs/06_status/proof/WORK-2026092404/work-order.md`, `docs/06_status/readiness/readiness-score.json`, `packages/db/src/repositories.ts`, `packages/db/src/runtime-repositories.ts`, `scripts/ci/deploy-config-rollback.test.ts`. Lane-scope files changed by the merge: 0. Superseded anchor, not
withdrawn: `16727dd07d7a9556f4a5e9ac259e1032d1ee6364`. `verify` re-runs on the new head.

### Re-anchor to `ec8165ec3385ad4caf154e40c6b7a59aa8c36689`

Branch refreshed from origin/main `677593f22` after main advanced. The merge brings in only main's own
changes: `docs/06_status/readiness/readiness-score.json`. Lane-scope files changed by the merge: 0. Superseded anchor, not
withdrawn: `351a5b49178ab051d2fdd39a6aa5811828a46dff`. `verify` re-runs on the new head.
