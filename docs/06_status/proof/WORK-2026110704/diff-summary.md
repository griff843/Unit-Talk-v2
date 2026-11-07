# Diff summary: WORK-2026110704

| File | Change |
|---|---|
| apps/api/src/grading-cron.ts | Consecutive-failure policy, bounded exponential retry, stable terminal event, bounded ops alert, injected exit handler and successful-cycle liveness refresh |
| apps/api/src/grading-cron.test.ts | Repository fault recovery/exhaustion, budget reset, alert rejection/timeout, exit and marker-write fault coverage |
| apps/api/src/grading-cron-health.ts | Local marker writer and freshness healthcheck CLI with three-poll bound |
| apps/api/src/grading-cron.test.ts (grading-cron-health: test) | Missing, fresh, expired, future and malformed markers |
| deploy/production/docker-compose.yml | Only grading-cron healthcheck command uses marker freshness |
| docs/06_status/proof/WORK-2026110704/ | Required executor evidence and provenance |

Implementation SHA: c2130be76c7f1beaea49189649ec69027e52e4b0
Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1837
