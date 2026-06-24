# UTV2-1298 — Verification

**Lane:** UTV2-1298 — bound MLB odds-path wall-clock (entity-resolve concurrency)
**Tier:** T2 · **Lane type:** runtime · **Executor:** Claude
**PR:** #PENDING · **Merge SHA:** PENDING

## Summary
The MLB odds cycle hit the 240s per-league wall-clock because entity resolution did ~1,700 sequential PostgREST upserts (events + ~55 players/event × ~15 events: participant + event-participant upserts) on a heavy slate. This lane instruments the entity-resolution phase and parallelizes the per-event player upserts under a bounded, env-configurable, reversible concurrency cap. Events stay sequential (shared team cache); idempotency (`onConflict`) and fail-closed semantics are preserved.

## Verification

### Static (branch)
- `pnpm type-check`: PASS (exit 0).
- `pnpm test` (full, all workspaces): PASS — **3052 pass / 0 fail / 0 skipped**. New: `entity-resolver.test.ts` (4) + `mapWithConcurrency` cases in `cooperative.test.ts` (5).
- `pnpm lint` (changed files): PASS.
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

## Post-deploy proof (PENDING DEPLOY)
| # | Required signal | Result | Evidence |
|---|---|---|---|
| 1 | MLB odds path completes under 240s on a heavy slate | PENDING | |
| 2 | entity-resolution timing visible + materially below the sequential estimate | PENDING | new `entityResolution` phase-timing + `[ingestor] entity-resolution sgo/MLB` log |
| 3 | provider_offer_history/current rows persist after deploy | PENDING | |
| 4 | no provider_offer_history dedup statement_timeout regression | PENDING | |
| 5 | no statement_timeout / schema-cache / 521 storm | PENDING | |
| 6 | RestartCount flat; ingestor resident | PENDING | |
| 7 | finalized-repoll still runs normally; game_results moves when candidates exist | PENDING | |

## R-level compliance
Diff touches `apps/ingestor/**` only. `scripts/ci/r-level-check.ts` (CI "R-Level Compliance Check"): expected PASS (ingestor-provider scope, no R2–R5 artifacts).

## Guardrails honored
No DDL. No schema/index/retention. No DB mutation outside normal runtime flow. No archive/object-store/durable work. No backfill. No >48h backlog mutation. No public Discord. No P3 cert. UTV2-1042 untouched. No CLV/ROI/edge claims. No secrets printed (structured logs are counts only). No fabricated proof. No loosened freshness/scoring/settlement thresholds. Critical writes fail-closed.
