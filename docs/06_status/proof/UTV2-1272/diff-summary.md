# UTV2-1272 — Diff Summary

**Branch:** `claude/utv2-1272-appenv-scheduling-and-clv-diagnostic` · **Lane type:** runtime · **Tier:** T1
**Base:** `e7213ad7` (main) · **Merge SHA:** `778ebcd34cbb43c52df9f09852dffc8377b87078` (PR #1020, squash-merged)

Wave 1 of the production-evidence mission, PM-rescoped (2026-06-13): fix the confirmed AppEnv scheduling
gap, harden SGO key-resolution diagnostics against false alarms, and read-only diagnose the forward-flow
CLV blocker. No CLV resolver semantics changed; no production rows mutated.

## Code changes

| File | Change |
|---|---|
| `packages/config/src/env.ts` | Declare the 6 `UNIT_TALK_INGESTOR_*` adaptive-scheduling vars in `AppEnv` and populate them in `loadEnvironment()`. Previously absent → values set only in the container env were invisible to the ingestor (root cause of "scheduling=disabled"). |
| `packages/config/src/env.test.ts` | Test: `loadEnvironment` surfaces all 6 scheduling vars, including container-style override layer. |
| `apps/ingestor/src/index.ts` | Drop the unsafe `env as SchedulerEnv` cast (AppEnv now satisfies SchedulerEnv structurally). Emit a structured SGO key-resolution diagnostic when no active key resolves. |
| `apps/ingestor/src/scheduler.test.ts` | New: `parseSchedulerConfig` + `resolveCurrentPollIntervalMs` peak/off-peak/fixed resolution. |
| `apps/ingestor/src/sgo-key-manager.ts` | New `buildSgoKeyResolutionDiagnostic()` — distinguishes `SGO_KEY_UNCONFIGURED` from `SGO_KEY_PROBE_FAILED` (keys present but probe failed this cycle), preventing the misleading "SGO_API_KEY missing" false alarm. Keys stay masked. |
| `apps/ingestor/src/sgo-key-manager.test.ts` | New: candidate generation (singular→plural fold, dedup, masking) + diagnostic classification + no-secret assertions. |
| `.env.example` | Document the 6 scheduling vars with safe defaults (scheduling disabled by default). |
| `apps/api/src/scripts/utv2-1272-missing-event-context-diagnostic.ts` | New read-only diagnostic for the forward-flow CLV blocker. SELECT-only, exits 0. |

## Behavior impact

- **Scheduling vars now reach runtime.** With `UNIT_TALK_INGESTOR_SCHEDULING_ENABLED=true`, the ingestor
  resolves peak/off-peak intervals; previously the values were silently dropped and scheduling stayed
  fixed/disabled regardless of deploy env.
- **No false "SGO_API_KEY missing" alarms.** When keys are configured but a probe fails for a cycle, the
  log now reports `SGO_KEY_PROBE_FAILED` with candidate count + masked probe statuses instead of implying
  misconfiguration. (Ingestion is demonstrably live — `provider_offer_history` took ~105k writes/24h.)
- **No resolver/semantic change.** CLV computation, evidence semantics, and provider-truth classification
  are untouched. The diagnostic only reads.

## Out of scope (intentionally not committed on this branch)

- `docs/06_status/planning/PRODUCTION_TRUTH_MAP.md` — lives under `planning/` (not a runtime-lane path);
  kept as the mission deliverable in the working tree, not part of this lane commit.
- Pre-existing untracked files from prior sessions (`UTV2-1236/evidence.json`, `verify-utv2-1266.ts`,
  planning packets, `.ops/sync/UTV2-1263.yml`) — not this lane's work.
- `clv-service.ts` stale-comment cleanup — deferred to avoid touching the resolver under the no-semantic-change guardrail.
