# Diff summary: WORK-2026110801

| File | Change |
|---|---|
| `apps/api/src/grading-cron.ts` | `startGradingCronLoop` calls `refreshLiveness()` at the start of every cycle (inside the existing `try`, before `runGradingCronCycle`), in addition to the existing end-of-cycle refresh. Comment records the intended bound: a pass longer than 3 x poll reads unhealthy. No timer, no other behaviour change. |
| `apps/api/src/grading-cron.test.ts` | Four existing tests re-expressed for the added refresh call (transient-recovery counts, marker-after-exhaustion, liveness-write-failure sequence). New tests: start-refresh ordering, failing-pass handling, end-of-cycle write failure, and two real-marker timeline tests (12 min pass healthy; 15 min bound healthy; 17 min reads unhealthy). 31/31 pass. |
| `.ops/work/WORK-2026110801.md` | Work order (T2). |
| `docs/06_status/proof/WORK-2026110801/` | This proof. |

Not changed: `grading-cron-health.ts`, `deploy/production/docker-compose.yml`, the poll interval, env, schema, delivery, kill switches, provider configuration.

## SHA Binding

Merge SHA: pending merge
PR: pending
