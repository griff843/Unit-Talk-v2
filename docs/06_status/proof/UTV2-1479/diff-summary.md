# UTV2-1479 Diff Summary

Branch-head SHA (pre-merge): `fd951bf281fceccf0ed6838fa923a7556a6439f6`

## Summary

Classification: during the UTV2-1477 P0 investigation, `unit-talk-worker-1` was found
healthy-idle, not wedged. `worker.heartbeat` system_runs rows (611 in the last hour,
essentially real-time) confirm the process cycles normally. `distribution.process` rows
are absent only because the worker's configured target (`discord:1296531122234327100`)
has zero claimable outbox rows — all real queue volume sits under `discord:canary` /
`discord:best-bets`, which this worker is not configured to drain. This corrects an
earlier assumption during UTV2-1477 that the worker was DB-timeout-wedged.

Target-exclusion investigation (read-only, no reconfiguration performed): `UNIT_TALK_DISTRIBUTION_TARGETS`
is sourced from a GitHub Actions secret at deploy time (`.github/workflows/deploy.yml:222,396`),
defaulting in-code to `discord:canary` only when unset (`apps/worker/src/runtime.ts:266`).
Production's actual value (`discord:1296531122234327100` only) is therefore an explicit
deployment-time configuration choice, not a code default or fallback gap — whether that
scope is intentional is a deploy-secret/business decision outside what this read-only
investigation can resolve from the repo alone, and is flagged here for PM/deploy-owner
follow-up rather than assumed either way.

## Files changed

- `apps/worker/src/runner.ts` — added a `console.log({event: 'worker.heartbeat', ...})`
  line immediately after the existing `worker.heartbeat` `system_runs` write, so liveness
  is visible in `docker logs` without a live DB query. No change to cycle logic, claim
  logic, delivery logic, or retry/circuit-breaker behavior.
- `apps/worker/src/worker-runtime.test.ts` — new test asserting exactly one
  `worker.heartbeat` log line is emitted per cycle, alongside the existing system_runs
  assertion.
- `docs/05_operations/QUEUE_READINESS_SEMANTICS.md` — new section documenting that
  `distribution.process` row absence is NOT a liveness signal; `worker.heartbeat` is.

## Scope

No worker execution changes, no queue behavior changes, no retries, no dispatch changes,
no schema changes, no production mutation, no target reconfiguration — logging + docs only.

## R-level compliance

```
Verdict: PASS
Changed files: 5
Rules matched: lifecycle-fsm

Advisory (PM-gated) artifacts missing:
  - r4-fault-report [PM-gated]
```

R4 is PM-gated advisory for this path pattern (`apps/worker/**` matches `lifecycle-fsm`);
R1 (tests) is retained and satisfied by the new heartbeat-log test above. No behavior
change to lifecycle FSM, submission, or outbox delivery — this is a log-line addition.
