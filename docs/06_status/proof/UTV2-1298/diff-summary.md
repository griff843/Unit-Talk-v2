# UTV2-1298 — Diff Summary

**Lane:** UTV2-1298 — bound MLB odds-path wall-clock (entity-resolve concurrency)
**Tier:** T2 · **Lane type:** runtime · **Executor:** Claude

## Files changed
- `apps/ingestor/src/cooperative.ts` — add `mapWithConcurrency(items, concurrency, fn)`: bounded-concurrency async map, order-preserving, fail-closed/deterministic (captures first error, stops dispatching, rethrows). `concurrency <= 1` runs fully sequential.
- `apps/ingestor/src/entity-resolver.ts` — `resolveSgoEntities`:
  - **Instrumentation first:** return `EntityResolutionTimings` (total / event-upsert / team-link / player-upsert / event-participant ms + counts of events/teamLinks/players/eventParticipants + concurrency + errors).
  - **Bounded concurrency:** the per-event player loop (the ~110 round-trips/event that dominate the ~1,700-call slate) now resolves via `mapWithConcurrency`. Events stay sequential (shared `teamCache`); team links stay sequential (2/event).
  - `resolveEntityConcurrency()` — conservative default 8; `UNIT_TALK_INGESTOR_ENTITY_CONCURRENCY` overrides; `UNIT_TALK_INGESTOR_ENTITY_RESOLUTION_SEQUENTIAL=true` forces sequential (reversible). `linkResolvedTeam` returns its link count for telemetry.
- `apps/ingestor/src/ingest-league.ts` — merge entity-resolution timings into the cycle `phase timings` log + emit a structured `[ingestor] entity-resolution sgo/<league>` line (counts only, no payloads/secrets).
- `apps/ingestor/src/cooperative.test.ts` — `mapWithConcurrency` tests: order, cap honored, sequential at concurrency 1, zero/non-finite coercion, fail-closed early stop.
- `apps/ingestor/src/entity-resolver.test.ts` (new) — all writes preserved + no duplicate links, cap honored, env sequential fallback reversible, failed write fails closed (rejects, early stop).

## Behavior
- **Before:** entity resolution did ~1,700 sequential PostgREST upserts on a heavy MLB slate ≈ 235-336s → hit the 240s wall-clock; offers never persisted.
- **After:** per-event player upserts run at a bounded concurrency (default 8) → entity resolution drops to tens of seconds, leaving margin for offer-persist within 240s. Idempotency (`onConflict`) unchanged; correctness preserved; reversible via env flag.

## Out of scope (guardrails honored)
No DDL. No schema/index/retention changes. No DB mutation outside the normal runtime flow. No archive/object-store/durable work. No backfill. No >48h backlog mutation. No loosened freshness/scoring/settlement thresholds. Critical writes stay fail-closed.
