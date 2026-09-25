# WORK-2026092503 — a deliberate delivery skip is visible in the worker log

Tier: T1 (mechanical floor: `apps/worker/src/` is Tier C; declared T2 would be escalated) · Lane type: runtime · Executor: claude

Repo-owned work order (tracker independence, ratified 2026-09-05). Origin: Linear **UTV2-1952**.
Linear was not reachable from this session (no credential), so the lane runs under this
repository-owned identity. No Linear state was moved.

## Problem

When the worker skips an outbox row deliberately — the target's kill switch is engaged, or the
target is disabled in the registry — it writes nothing. The row is never claimed, so
`attempt_count` stays 0, which is exactly what a dead worker leaves behind. An operator looking at
`2cc92f4b` (pending on `official-picks` behind `killed = true`) cannot tell a stopped lane from a
dead worker.

## Outcome

1. `runWorkerCycles` emits one structured line per deliberate skip, per cycle:
   `worker.delivery-skipped-kill-switch` or `worker.delivery-skipped-target-disabled`, with
   `workerId`, `target`, `cycle`, `reason` and `outboxClaimed: false`.
2. Logging only. No claim, no status change, no attempt increment; kill-switch and registry
   semantics are unchanged.
3. Tests prove each skip logs its line and never claims, and that an attempted delivery emits no
   skip line.

## File scope

- `apps/worker/src/runner.ts`
- `apps/worker/src/worker-runtime.test.ts`
