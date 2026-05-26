# Verification - UTV2-1098: Revocation Trigger Wiring

**Tier:** T1  
**Executor:** Codex  
**Verified source SHA:** `e3e82f4a7a1c223e1cf03b592fd593828f52f965`  
**Supabase project:** `zfzdnfwdarxucxtaojxm`

## Scope

This lane is proof-only. The allowed file scope is limited to:

- `docs/06_status/proof/UTV2-1098/evidence.json`
- `docs/06_status/proof/UTV2-1098/verification.md`

No source code, migrations, generated DB types, docs outside the proof path, or Tier C paths were changed.

## Revocation Wiring Checked

Static inspection confirmed the existing certification state machine wires revocation triggers through:

- `REVOCATION_TRIGGERS` in `packages/invariants/src/certification/types.ts`
- `assertRevocationConstraints()` in `packages/invariants/src/certification/state-machine.ts`
- `computePropagation()` dependency revocations using `dependency_revoked`
- Certification tests covering revoked-without-trigger rejection, trigger-on-non-revoked rejection, terminal revoked state, and dependency propagation.

## Verification Commands

```text
pnpm type-check
PASS - exit 0
```

```text
pnpm test
PASS - exit 0
Final observed ops suite summary: 612 tests, 612 pass, 0 fail.
```

```text
pnpm test:db
PASS - exit 0
7 tests, 7 pass, 0 fail.
```

Live DB smoke covered submission/settlement persistence, invalid atomic enqueue rollback, invalid delivery rollback, invalid settlement rollback, participant duplicate prevention, and additive settlement correction invariants.

## Runtime Proof

Live Supabase query at `2026-05-26T17:13:54.680Z`:

```json
{
  "project_ref": "zfzdnfwdarxucxtaojxm",
  "tables": {
    "certification_records": { "count": 0 },
    "certification_transition_events": { "count": 0 }
  },
  "current_state_sample": []
}
```

`pnpm pipeline:health` exited 0. Queue proof:

- `distribution_outbox.sent`: 439
- processing rows older than 5 minutes: none
- pending rows older than 30 minutes: none
- dead letter rows: none
- failed rows: none
- worker verdict: `HEALTHY - idle, no eligible rows in queue`

The generic `pnpm proof:t1 -- --issue UTV2-1098 --change "revocation trigger wiring proof" --skip-verify --json` probe returned a failing worker-heartbeat verdict (`DOWN_NO_RUNS_OR_HEARTBEATS_IN_WINDOW`) while also reporting zero stale processing, stale pending, and deferred pending rows. Per the lane brief, worker-down proof posture is known pre-existing and non-blocking when worker delivery is not in this proof path; concrete DB row-count and queue-health evidence is recorded in `evidence.json`.

## R-Level

Changed paths are proof artifacts only. No paths in `docs/05_operations/r1-r5-rules.json` matched this diff, so R-level compliance is:

```text
N/A - no lifecycle/domain/strategy/UI paths touched by this proof-only diff.
```

Command result:

```text
npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 0
Rules matched: (none) - no R-level artifacts required for this diff
```

## Closeout Blocker

`pnpm verify` did not reach lint, type-check, build, or test. It failed immediately at `pnpm ops:sync-check`:

```text
[sync-check] MISMATCH: .ops/sync.yml lists "UTV2-1072" but branch "codex/utv2-1098-revocation-trigger-wiring" expects "UTV2-1098".
Create .ops/sync/UTV2-1098.yml with entities.issues: [UTV2-1098] to fix this permanently.
```

The fix requires editing `.ops/sync.yml` or creating `.ops/sync/UTV2-1098.yml`, both outside this lane's allowed file scope. No PR was opened from this lane because the required `pnpm verify` gate is not green.
