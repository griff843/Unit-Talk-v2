# PROOF: WORK-2026092701

MERGE_SHA: c2dc9800c75d3510b6b172f02259a4dc4e2aa6b3

Issue: WORK-2026092701
Tier: T2
Lane type: governance
Branch: claude/work-2026092701-pipeline-health-deployed-worker
result: pass

## ASSERTIONS:

- [x] The monitor resolves worker targets from a fresh `worker.heartbeat`'s `details.targets`. It
      falls back to an explicit `UNIT_TALK_DISTRIBUTION_TARGETS` only without one, and otherwise
      raises a critical "deployed worker target set unknown". The `discord:canary` default is
      removed. Tests: "a fresh heartbeat names the deployed worker…", "a heartbeat outside the
      window…", "with no usable heartbeat and no env value…", "malformed heartbeat details…",
      "a heartbeat stamped in the future…".
- [x] A pending row on a polled target whose kill switch is killed, **or has no row**, is held:
      a warning, never a reroute. A released switch or an unpolled target is not held. Tests:
      "…switch is killed is held", "…switch has no row is held…", "…switch is released is not
      held…", "a killed target the worker does not poll is not held…".
- [x] An unreadable kill-switch table holds nothing, and the script reports it as critical and
      exits 1. Test: "an unreadable kill-switch table holds nothing…".
- [x] Processing rows on unpolled targets are a named warning, not `processing_stale`, and are
      never dropped from the report. With an unknown target set none are classed unclaimable.
- [x] Genuine failures stay critical: in the production-shape test the stranded
      `discord:canary` pending row still raises `target_mismatch`, and the queue is still `down`.
- [x] No database write, containment change, or change to `packages/observability`, the worker
      or any delivery path.

## EVIDENCE:

### 1. Live inputs, read-only (production `zfzdnfwdarxucxtaojxm`, 2026-09-27 14:19Z)

```
worker.heartbeat newest 14:19:17Z  details={"cycle":66444,"targets":["discord:official-picks"]}
delivery_kill_switch  official-picks=true best-bets=true trader-insights=true exclusive-insights=true
non-sent outbox (governance brake excluded):
  pending      discord:official-picks      1
  pending      discord:canary              3
  processing   utv2-1497-canary-{adb6af4f,3a2ca3ff,2d4eb56e,c0aae7fd}   8 each (32)
  dead_letter  discord:best-bets 40, discord:canary 1
```

### 2. Those inputs replayed through the classifier and the real `evaluateQueueHealth`

```
source: heartbeat   targets: [discord:official-picks]   held: 1   unclaimable: 32   status: down
critical target_mismatch
critical dead_letter
critical pending_stale discord:canary   (x4: summary + 3 rows)
critical target_mismatch discord:canary (x3)
critical delivery_stale
```

The 2026-09-26 run (`36247961530`) raised two criticals that are gone here:
`processing_stale` (32) and the `official-picks` "reroute/remove" advice. The ones that remain
are real.

### 3. Mutation drill

The fail-closed missing-row rule was mutated to require an explicit `killed = true`:

```
not ok 8 - a pending row whose switch has no row is held, because the worker is fail-closed on a missing row
# fail 1
```

The file was restored from a copy, and the suite passes 16/16.

## Verification

```
pnpm exec tsx --test scripts/ops/pipeline-health-classification.test.ts   # pass 16, fail 0
pnpm test:ops                                                             # tests 3499, pass 3499, fail 0
pnpm type-check                                                           # exit 0
pnpm exec eslint scripts/pipeline-health.ts scripts/ops/pipeline-health-classification*.ts   # exit 0
```

`pnpm test` in preflight hit one failure in `scripts/ops/verify-semaphore.test.ts` ("a killed
process releases its slot through the signal path"), which this lane does not touch. It passed 3
of 3 isolated reruns, so it is load-dependent.

A direct run of `scripts/pipeline-health.ts` from the workstation could not reach production,
because `local.env` carries containment placeholders rather than the production URL. Evidence 1–2
substitutes a governed read-only SQL read of the same inputs.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1666
