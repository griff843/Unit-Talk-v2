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
Merge SHA: 29561f7fb478fa1f37fbb3d1a8dbdefd512fc108
PR: https://github.com/griff843/Unit-Talk-v2/pull/1837

Compose healthcheck is a plain node probe (not tsx) that reads UNIT_TALK_GRADING_CRON_POLL_MS from the container env; see FINAL VERDICT in verification.md.
