# PROOF: WORK-2026092401

MERGE_SHA: fdacdda21abfc2efef7f0e532f6fb7c9563b19ff

> Pre-merge, the merge row carries the execution SHA, the last commit on this lane that changes
> anything outside `docs/06_status/proof/WORK-2026092401/` and the lane manifest.
> `post-merge-lane-close.yml` rebinds merge authority only after GitHub supplies the merged-PR
> attestation.

Generated at: 2026-09-24T12:46:23.000Z
Issue: WORK-2026092401
Tier: T1
Lane type: governance
Branch: claude/work-2026092401-conveyor-unprovisioned-state
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1643
Head SHA: fdacdda21abfc2efef7f0e532f6fb7c9563b19ff
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

Measured at `fdacdda21abfc2efef7f0e532f6fb7c9563b19ff` in the lane worktree.

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

$ pnpm exec tsx scripts/ci/r-level-check.ts --issue WORK-2026092401 --base origin/main --head fdacdda21abfc2efef7f0e532f6fb7c9563b19ff
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
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --issue WORK-2026092401 --base origin/main --head fdacdda21abfc2efef7f0e532f6fb7c9563b19ff`: PASS, 9 changed files, no R-level artifacts required

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
Execution SHA: fdacdda21abfc2efef7f0e532f6fb7c9563b19ff

Execution anchor: `fdacdda21abfc2efef7f0e532f6fb7c9563b19ff` is the only implementation commit on this lane. Its parent is
`origin/main` `decd67afaf99eeb41320c40eca14a9d9e9cf92a6`.

`work-order.md` in this directory is a byte-identical copy of the repository-owned work order
`.ops/work/WORK-2026092401.md`, which exists only as an uncommitted file. It is kept here because
the lane's own proof directory is the one path that the closeout scope check (S1) and the
file-scope guard both admit without widening `file_scope_lock`.
