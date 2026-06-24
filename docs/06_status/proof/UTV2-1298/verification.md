# UTV2-1298 — Verification

**Lane:** UTV2-1298 — bound MLB odds-path wall-clock (entity-resolve concurrency)
**Tier:** T2 · **Lane type:** runtime · **Executor:** Claude
**PR:** #1052 (squash-merged) · **Merge SHA:** `975ee453e20fe15073a88e7f65c492548e7fe69d`
**Deploy:** Deploy run 28074045811 — completed/success. Prod image `ghcr.io/griff843/unit-talk-v2/ingestor:975ee453…` live on Hetzner (resident since 04:02:02Z, RestartCount=0).

## Summary
The MLB odds cycle hit the 240s per-league wall-clock because entity resolution did ~1,700 sequential PostgREST upserts (events + ~55 players/event × ~15 events: participant + event-participant upserts) on a heavy slate. This lane instruments the entity-resolution phase and parallelizes the per-event player upserts under a bounded, env-configurable, reversible concurrency cap. Events stay sequential (shared team cache); idempotency (`onConflict`) and fail-closed semantics are preserved.

## Verification

### Static (branch)
- `pnpm type-check`: PASS (exit 0).
- `pnpm test` (full, all workspaces): PASS — **3052 pass / 0 fail / 0 skipped**. New: `entity-resolver.test.ts` (4) + `mapWithConcurrency` cases in `cooperative.test.ts` (5).
- `pnpm lint` (changed files): PASS.
- `pnpm verify` (env:check + lint + type-check + build + test): PASS — CI `verify` job green on PR #1052 head + merge SHA `975ee453`.
- Ingestor suite: 254 pass / 0 fail (4 DB-gated skips).

### Live-DB smoke (`pnpm test:db`, real Supabase, branch)
```
# tests 7
# pass 7
# fail 0
# skipped 0
```
(`pnpm test:db` = `tsx --test apps/api/src/database-smoke.test.ts`, exit 0 — confirms entity/participant/settlement write paths intact against real Supabase.)

### Tests prove (per PM safety bounds)
- bounded concurrency preserves all entity + event-participant writes, no duplicate/incorrect links
- concurrency cap is honored (max in-flight ≤ cap)
- sequential fallback (`UNIT_TALK_INGESTOR_ENTITY_RESOLUTION_SEQUENTIAL=true`) is reversible and overrides the concurrency option
- a failed entity write fails closed (rejects) and stops dispatching — deterministic
- existing ingestor suite remains green

## Post-deploy proof (host + read-only DB; 2026-06-24, prod SHA 975ee453)
| # | Required signal | Result | Evidence |
|---|---|---|---|
| 1 | MLB odds path completes under 240s on a heavy slate | **YES** | `league=MLB TIMEOUT after 240000ms` occurrences since deploy = **0** (was every cycle pre-deploy). Heavy slate: 43 events / 341 players / 24.6 MB odds payload (size-guarded). |
| 2 | entity-resolution timing visible + materially below the sequential estimate | **YES** | `[ingestor] entity-resolution sgo/MLB: 66589ms concurrency=8 events=43 players=341 eventParticipants=427 teamLinks=86 errors=0` — **66.6s** vs the ~235-336s sequential estimate (the cost that blew the 240s). |
| 3 | provider_offer_history/current rows persist after deploy | **YES** | **11,000** `provider_offer_history` + **10,750** `provider_offer_current` rows written since deploy (04:02:02Z); last write 04:04:42Z. Fresh MLB odds restored. |
| 4 | no provider_offer_history dedup statement_timeout regression | **YES** | `Failed to load existing provider offer history` occurrences = **0** |
| 5 | no statement_timeout / schema-cache / 521 storm | **YES** | statement_timeout=0, schema-cache/521/PGRST storm=0 |
| 6 | RestartCount flat; ingestor resident | **YES** | RestartCount=0, resident since 04:02:02Z, healthy |
| 7 | finalized-repoll still runs normally; game_results moves when candidates exist | **YES** | finalized-repoll/results-telemetry emitted normally each cycle; game_results settlement path intact (finalized-repoll throughput drain is the separate UTV2-1297 lane) |

### Outcome
The diagnosis is empirically confirmed: entity resolution was the dominant cost (66.6s measured at concurrency 8 for a 43-event/341-player slate, instrumented). The MLB odds cycle now completes **under 240s** and **persists fresh offers** (11,000 rows) — the end goal. The dedup fix (prior lane) holds (0 statement_timeout). Critical writes stayed fail-closed; errors=0.

## Runtime proof row_counts (read-only live Supabase, post-deploy)
runtime_proof row_counts: provider_offer_history rows since deploy = 11000; provider_offer_current rows since deploy = 10750; MLB entity-resolution = 66589ms at concurrency 8 (events=43 players=341 errors=0); league=MLB 240000ms TIMEOUT occurrences since deploy = 0; dedup statement_timeout occurrences = 0; ingestor RestartCount = 0.

## R-level compliance
Diff touches `apps/ingestor/**` only. `scripts/ci/r-level-check.ts` (CI "R-Level Compliance Check" on PR #1052): **PASS** (green on merge SHA `975ee453`; ingestor-provider scope, no R2–R5 artifacts).

## Guardrails honored
No DDL. No schema/index/retention. No DB mutation outside normal runtime flow. No archive/object-store/durable work. No backfill. No >48h backlog mutation. No public Discord. No P3 cert. UTV2-1042 untouched. No CLV/ROI/edge claims. No secrets printed (structured logs are counts only). No fabricated proof. No loosened freshness/scoring/settlement thresholds. Critical writes fail-closed.
