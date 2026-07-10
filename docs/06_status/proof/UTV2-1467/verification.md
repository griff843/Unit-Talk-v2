# PROOF: UTV2-1467 merge-train (Design B batched-merge protocol)

Issue: UTV2-1467
Tier: T1
Lane type: governance
Branch: claude/utv2-1467-merge-queue
MERGE_SHA: c93391b504193a0c968f458e9c8246a44a7f8f71

Implementation commit on this branch (ancestor of the PR's current head — this proof file itself lands in a later commit on top of it, avoiding the SHA self-reference circularity). PR not yet merged in this session (PM standing constraint: no merge); `MERGE_SHA` here is the implementation-commit convention accepted by `executor-result-validator.yml`'s ancestor-or-equal check (same pattern used by prior governance lanes' proof files).

## Verification

`pnpm test:db` (`apps/api/src/database-smoke.test.ts`) executed fresh against the live Supabase project (`zfzdnfwdarxucxtaojxm`) for this proof update. Literal TAP output:

```text
TAP version 13
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 105046.225374
```

This lane's diff touches no product runtime, pick pipeline, or Supabase write path — this run is the T1-mandatory live-DB environment-health check, not a feature-behavior proof.

ASSERTIONS:

- [x] `pnpm ops:merge-wrapper merge-train --candidates-file <path.json> [--dry-run]` is a real, operator-invokable CLI subcommand (not a library-only function) — CLI smoke test below, exit code 0
- [x] Merge mutex is acquired exactly once per batch (not once per PR) and released exactly once at the end, including on partial failure or an unexpected exception from an injected dependency
- [x] Required contexts (`verify`, `Executor Result Validation`, `Merge Gate`, `P0 Protocol`) are re-validated per PR exactly as today — no changes to `ci.yml`, `merge-gate.yml`, `executor-result-validator.yml`, or `p0-protocol.yml`
- [x] `pnpm verify` (env:check + sync-check + system-alignment-check + automation-coverage-check + lint + type-check + build + test + smart-form verify + verify:commands) passes on this commit
- [x] `pnpm test` passes 760/760, reproduced across 3 separate full-suite runs (isolation is not a fluke)
- [x] `pnpm test:db` passes 7/7 against live Supabase (`zfzdnfwdarxucxtaojxm`) — required for T1 even though this lane's diff touches no product runtime
- [x] `scripts/ci/r-level-check.ts` verdict PASS, no R-level artifacts required for this diff
- [x] `scripts/ops/ops-merge-wrapper.test.ts` passes 35/35 (23 pre-existing + 12 new: 10 merge-train behavior tests + 2 P1/P2 regression tests added after Codex review)
- [x] P1 fix (Codex review): executor-result comment is re-posted against the new head SHA BEFORE waiting on required checks, not after — regression test proves this ordering by modeling the real validator's stale-SHA failure behavior
- [x] P2 fix (Codex review): the Head-SHA rewrite regex handles both bold-label placements the validator's own field parser accepts (`**Head SHA**: x` and `**Head SHA:** x`) — regression test exercises both forms directly
- [x] Acceptance criterion 3 (a board of 3 green PRs merges in under half the serial wall-clock) is measured, not estimated, via a controlled/simulated timing comparison grounded in the decision packet's own 2N-3N-CI-cycle cost model — median of 3 real wall-clock trials each side, reproduced across 4 separate runs, ratio 0.275-0.286 in every run (all under the required < 0.5 threshold)

EVIDENCE:

```text
pnpm verify (implementation commit c93391b504193a0c968f458e9c8246a44a7f8f71) — exit 0
  ops:sync-check, ops:system-alignment-check, ops:automation-coverage-check: pass
  env:check: pass
  lint (eslint . --cache): pass, zero findings
  type-check (tsc -b tsconfig.json): pass
  build (tsc -b tsconfig.json): pass
  test: 760/760 pass, 0 fail, 0 skipped
  smart-form verify + verify:commands: pass

scripts/ci/r-level-check.ts --base main --head HEAD
Verdict: PASS
Changed files: 14
Rules matched: (none) — no R-level artifacts required for this diff

pnpm test:db (apps/api/src/database-smoke.test.ts, live Supabase zfzdnfwdarxucxtaojxm)
TAP version 13
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
1..7
# tests 7
# pass 7
# fail 0

tsx --test scripts/ops/ops-merge-wrapper.test.ts (post P1/P2 fixes)
ok 24 - merge-train: evaluateStatusCheckRollup evaluates pending/success/failure correctly
ok 25 - merge-train: isExecutorResultComment and buildRepostedExecutorResultBody
ok 26 - merge-train: buildRepostedExecutorResultBody handles bold Head SHA labels (P2 regression)
ok 27 - merge-train: happy path drains all candidates and releases the lock
ok 28 - merge-train: reposts the executor-result comment BEFORE waiting on checks (P1 regression)
ok 29 - merge-train: a failed PR mid-train stops the drain, leaves earlier merges intact, and releases the lock
ok 30 - merge-train: an unexpected exception from a dependency is caught, releases the lock, and stops the drain
ok 31 - merge-train: a merge failure (not update-branch) still stops the drain cleanly
ok 32 - merge-train: invalid input (empty candidates) fails closed before acquiring any lock
ok 33 - merge-train: invalid input (malformed candidate) fails closed with a clear message
ok 34 - merge-train: dry-run plans the batch, executes no commands, and still releases the lock
ok 35 - merge-train timing: a 3-PR batch completes in under half the simulated serial baseline (real measured wall-clock)
# merge-train measured (median of 3 real trials each): trainDurationMs=194 serialDurationMs=684 ratio=0.284 (acceptance requires < 0.5)
1..35
# tests 35
# pass 35
# fail 0

Timing comparison reproduced across 4 separate runs (isolated + 3 full-suite pnpm test/verify runs):
  isolated run:        trainDurationMs=183 serialDurationMs=665 ratio=0.275
  full-suite run 1:    trainDurationMs=190 serialDurationMs=668 ratio=0.284
  full-suite run 2:    trainDurationMs=194 serialDurationMs=678 ratio=0.286
  full-suite run 3:    trainDurationMs=194 serialDurationMs=684 ratio=0.284
All four runs < 0.5 required ratio.

CLI smoke test (operator-invokability):
$ pnpm ops:merge-wrapper merge-train --candidates-file <2-entry JSON> --dry-run
exit code: 0
{
  "ok": true,
  "code": "merge_train_dry_run",
  "entries": [
    { "issue_id": "UTV2-9001", "branch": "claude/utv2-9001-example", "pr": "9001", "status": "planned", "detail": "dry-run: no commands executed", "merge_sha": null, "duration_ms": 0 },
    { "issue_id": "UTV2-9002", "branch": "claude/utv2-9002-example", "pr": "9002", "status": "planned", "detail": "dry-run: no commands executed", "merge_sha": null, "duration_ms": 0 }
  ],
  "lock": { "ok": true, "code": "merge_lock_acquired" },
  "release": { "ok": true, "code": "merge_lock_released" }
}
.ops/merge-lock.json confirmed status "released" after the run.
```

## Scope note

This lane's diff (`scripts/ops/merge-wrapper.ts`, `scripts/ops/ops-merge-wrapper.ts` and their test files, `docs/05_operations/WORKFLOW_SPEC.md`, `docs/governance/LANE_CONCURRENCY_POLICY.md`) touches no product runtime, pick pipeline, or Supabase write path. `pnpm test:db` above is an environment-health proof (live-DB connectivity and monitored-table behavior), not a feature-behavior proof — the same pattern used by prior docs/ops-only T1 governance lanes. Acceptance criterion 3's timing proof is a controlled/simulated comparison rather than a live 3-PR GitHub board, explicitly authorized by PM's implementation directive for this exact reason (no merge authority this session; a live board would itself cost the ~9-minute-per-cycle wall-clock the decision packet measured).

## SHA Binding

Head SHA (implementation commit, ancestor of PR head): c93391b504193a0c968f458e9c8246a44a7f8f71
Merge SHA: not yet available — this lane is not merged in this session. Rebinds automatically via `ops:proof-generate --merge-sha` in the standard post-merge lane-close flow.

## Manifest scope correction

This manifest's `file_scope_lock` was created before UTV2-1495's hard file-scope guard (`scripts/ci/file-scope-guard.ts`) merged to main. That guard's trust boundary locks a newly-introduced lane manifest to the content of the commit that first added it, so this lane's own `docs/06_status/proof/UTV2-1467/**` paths — already required by `expected_proof_paths` since `ops:lane-start` created this manifest — were not recognized as declared scope once the branch synced with main post-UTV2-1495 merge. The manifest's `scope_override` block (added commit-after-commit `82823a50` → this commit) widens `file_scope_lock` to include only this lane's own pre-existing proof-directory paths, which were always part of its required deliverables and introduce no unrelated production code. PM-authorized per the same documented-override precedent UTV2-1495 itself established. Filed as a systemic follow-up: [UTV2-1518](https://linear.app/unit-talk-v2/issue/UTV2-1518) (the guard should auto-exempt a lane's own proof directory rather than requiring this override on every future lane).
