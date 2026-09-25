# PROOF: WORK-2026092503

MERGE_SHA: pending merge

> Pre-merge, the merge row is intentionally a placeholder. The Execution SHA row carries the
> verified implementation identity. `post-merge-lane-close.yml` rebinds merge authority only
> after GitHub supplies the merged-PR attestation.

Issue: WORK-2026092503
Origin: UTV2-1952
Tier: T1
Lane type: runtime
Branch: claude/work-2026092503-worker-skip-visibility
PR URL: PR_URL_BINDING
Execution SHA: ea6697ed3e99c17458d3f6c3490b3c7ce26a10b7
Head SHA: ea6697ed3e99c17458d3f6c3490b3c7ce26a10b7
result: pass

## ASSERTIONS:

- [x] A kill-switch skip emits one `worker.delivery-skipped-kill-switch` line per cycle, with
      `workerId`, `target`, `cycle`, `reason: kill-switch-engaged` and `outboxClaimed: false`.
- [x] A registry-disabled skip emits its own `worker.delivery-skipped-target-disabled` line
      (`reason: target-disabled`).
- [x] A skip is never an attempt: no `claimNext`/`claimNextAtomic` call, and the row stays
      `pending` with `attempt_count = 0` and no `claimed_at`/`claimed_by`.
- [x] An attempted delivery emits no skip line, and does claim (control).
- [x] Logging only. Both skip branches push the same result object and `continue` exactly as
      before; the log call precedes them and cannot throw (`JSON.stringify` of four strings, a
      number and a boolean). Kill-switch and registry semantics, containment and delivery targets
      are unchanged.
- [x] Each log call is mutation-proven: deleting either one alone turns exactly its named test red.

## EVIDENCE:

Measured on `ea6697ed3e99c17458d3f6c3490b3c7ce26a10b7` in the lane worktree.

```
$ pnpm exec tsx --test apps/worker/src/worker-runtime.test.ts
# tests 75
# pass 75
# fail 0

$ pnpm test
tests 6873, pass 6873, fail 0 (zero 'not ok' TAP lines across the workspace)
exit 0

$ pnpm type-check
exit 0

$ pnpm lint
exit 0

$ pnpm exec eslint apps/worker/src/runner.ts apps/worker/src/worker-runtime.test.ts
exit 0

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Rules matched: lifecycle-fsm
Advisory (PM-gated) artifacts missing: r4-fault-report [PM-gated]
```

### The mutation battery

Each mutation was applied alone, `worker-runtime.test.ts` run, and `runner.ts` restored from a
pre-mutation copy.

```
== M1 delete logDeliberateDeliverySkip('worker.delivery-skipped-kill-switch', ...)
not ok 73 - UTV2-1952: a kill-switch skip logs a structured line and leaves the row pending, unattempted
# pass 74
# fail 1
== M2 delete logDeliberateDeliverySkip('worker.delivery-skipped-target-disabled', ...)
not ok 74 - UTV2-1952: a registry-disabled skip logs its own structured line and leaves the row unattempted
# pass 74
# fail 1
== restored
# pass 75
# fail 0
```

### Operational note

The line is emitted every cycle the control holds, for every configured target it stops. At the
default 5 s poll that is about 17,000 stdout lines a day per stopped target (in `human-capper`
mode, one: `official-picks`). It is stdout only; nothing is written to the database.

## Verification
- [x] `pnpm type-check`: exit 0
- [x] `pnpm test`: exit 0, with 6873 tests, 6873 pass and 0 fail
- [x] `pnpm lint`: exit 0
- [ ] `pnpm verify`: not runnable locally (staging-target assertion). It is executed by the required `verify` check on this PR.
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: Verdict PASS

## Runtime Verification

### Live-DB half, deferred to CI

This lane carries `t1_live_db_precondition: deferred_to_ci` (preflight PT1 reported
`blocked_by_containment`). The staging half is supplied by the `Writable DB proof (staging only)`
job on the merge SHA, against staging `xskgrzbteyqdufktjrjx`. It is **not** fabricated here:
`runtime_proof.status` in `evidence.json` reads `PENDING_CI`, and is populated at closeout.

The change adds no read or write. The runtime behaviour it adds is a stdout line, proven against
the real `runWorkerCycles` loop with the in-memory repository bundle and the real
`InMemoryDeliveryKillSwitchRepository`. No production read or write was made.

## Merge SHA Binding

Merge SHA: pending merge
PR: PR_URL_BINDING
