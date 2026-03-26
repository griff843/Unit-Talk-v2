# T1 Contract: Automated Grading — Results Schema & Grading Service

> Tier: T1 (new migration, settlement write path change, cross-package repository extension)
> Contract status: **Ratified — ACTIVE** (2026-03-26)
> Produced: 2026-03-26
> Ratified: 2026-03-26 — audit complete; all prerequisites met; schema gap confirmed
> Supersedes: none
> Depends on: T1 Feed Entity Resolution — CLOSED; T1 Provider Ingestion — CLOSED; T1 CLV — CLOSED
> Authority: `docs/06_status/PROGRAM_STATUS.md` wins on conflict

---

## 1. Objective

Enable the system to automatically determine whether a posted pick won, lost, or pushed, and record that result as a settled pick without requiring manual operator input.

**The specific gap being closed:**

The domain math for grading exists and is tested:
- `resolveOutcome(actualValue, line)` in `packages/domain/src/outcomes/outcome-resolver.ts` — returns `'WIN' | 'LOSS' | 'PUSH'`
- `settlement_records.result` column exists and accepts `'win' | 'loss' | 'push' | 'void' | 'cancelled'`
- `settlement-service.ts` can write settlements for any pick in `posted` state

But three things are missing:
1. **No table to store actual game results** — the current `provider_offers` table is pre-game odds only; there is no final stat value anywhere in the schema
2. **No grading service** — nothing calls `resolveOutcome()` against a posted pick
3. **The settlement `source: 'feed'` path is hard-blocked** — by explicit guard in `settlement-service.ts:68-74`, pending a ratified contract

This contract resolves all three.

**After this lane:** When a pick is in `posted` state and a game result exists in `game_results` for that pick's event + participant + market, the grading service can automatically settle that pick with `source: 'grading'`, computed result, and audit trail. Operator can still correct or override via the existing settlement correction path.

---

## 2. Audit Summary

### What exists

| Item | State |
|------|-------|
| `resolveOutcome(actualValue, line)` | Tested, pure. In `packages/domain/src/outcomes/outcome-resolver.ts`. |
| `settlement_records.result` | `string \| null`. Accepts `'win' \| 'loss' \| 'push' \| 'void' \| 'cancelled'`. |
| `settlement_records.source` | Text field. Currently: `'operator' \| 'api' \| 'feed'`. No DB CHECK constraint. |
| `settlement-service.ts` — initial settlement path | Live. `recordInitialSettlement()` transitions `posted → settled`. |
| `pick.line` | Line at bet time. Available on every pick. |
| `pick.selection` | `'over …' \| 'under …'` — inferred by existing `inferSelectionSide()` in CLV service. |
| `pick.participant_id` | FK to `participants`. Used for CLV join. Same join path works for grading. |
| `events.status` | `'scheduled' \| 'in_progress' \| 'completed' \| 'postponed' \| 'cancelled'`. Managed by ingestor. |
| `events.metadata.starts_at` | Populated by entity resolver (Feed Entity Resolution lane). |
| `picks.status = 'posted'` | All picks awaiting grading are in this state. |

### What is missing

| Gap | How closed by this lane |
|-----|------------------------|
| No `actual_value` storage | Migration 012 — new `game_results` table |
| No grading service | New `apps/api/src/grading-service.ts` |
| `source: 'feed'` hard-blocked | Add `source: 'grading'` to schema; add internal `recordGradedSettlement()` path; keep HTTP block for `source: 'feed'` |
| No `GradeResultRepository` | Extend `packages/db/src/repositories.ts` |
| No grading endpoint | New `POST /api/grading/run` (internal) |

### Why T1

Three simultaneous T1 triggers per `SPRINT_MODEL_v2.md`:
1. **New schema migration** — `game_results` table (migration 012)
2. **Settlement write path change** — any modification to the settlement write path is explicitly T1
3. **Cross-package repository extension** — new `GradeResultRepository` in `@unit-talk/db`

---

## 3. Scope

### 3.1 Migration 012 — `game_results` Table

```sql
-- Migration 012: game_results — stores final stat values for grading
-- One row per (event, participant, market_key, source).
-- market_key uses the same namespace as provider_offers.provider_market_key
-- and picks.market — enabling direct join with no translation layer.

CREATE TABLE game_results (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id    UUID        NOT NULL REFERENCES events(id),
  participant_id UUID     REFERENCES participants(id),   -- NULL for game totals / team props
  market_key  TEXT        NOT NULL,                      -- e.g. 'assists-all-game-ou'
  actual_value NUMERIC    NOT NULL,
  source      TEXT        NOT NULL DEFAULT 'manual',     -- 'manual', 'sgo', etc.
  sourced_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now() NOT NULL,

  CONSTRAINT game_results_market_key_check
    CHECK (char_length(market_key) > 0),
  CONSTRAINT game_results_actual_value_finite
    CHECK (actual_value IS NOT NULL AND actual_value > -9999 AND actual_value < 99999),

  UNIQUE(event_id, participant_id, market_key, source)
);

CREATE INDEX game_results_event_participant_idx
  ON game_results (event_id, participant_id, market_key);
```

**Design notes:**
- `market_key` matches `picks.market` and `provider_offers.provider_market_key` exactly — no translation needed
- `participant_id` is nullable to support game totals and moneylines (team/event-level results)
- UNIQUE constraint on `(event_id, participant_id, market_key, source)` allows multiple sources per market (SGO + manual) without conflict
- `actual_value` stores the raw final stat number (e.g., `7.5` for assists, `112.5` for game total points)
- No `is_graded` denormalization — graded state is derivable from `settlement_records`

### 3.2 Add `'grading'` to Settlement Sources

In `packages/db/src/schema.ts`:

```typescript
export const settlementSources = ['operator', 'api', 'feed', 'grading'] as const;
```

No migration needed — `settlement_records.source` is a `text` column with no DB CHECK constraint. The TypeScript schema array is the authoritative enumeration.

### 3.3 `GradeResultRepository` Interface

Add to `packages/db/src/repositories.ts`:

```typescript
export interface GradeResultInsertInput {
  eventId: string;
  participantId: string | null;
  marketKey: string;
  actualValue: number;
  source: string;
  sourcedAt: string;
}

export interface GradeResultLookupCriteria {
  eventId: string;
  participantId: string | null;
  marketKey: string;
}

export interface GradeResultRepository {
  insert(input: GradeResultInsertInput): Promise<GradeResultRecord>;
  findResult(criteria: GradeResultLookupCriteria): Promise<GradeResultRecord | null>;
  listByEvent(eventId: string): Promise<GradeResultRecord[]>;
}
```

Add `GradeResultRecord = Tables<'game_results'>` to `packages/db/src/types.ts`.

Add `gradeResults: GradeResultRepository` to `RepositoryBundle` in `packages/db/src/index.ts`.

Implement `DatabaseGradeResultRepository` and `InMemoryGradeResultRepository` in `packages/db/src/runtime-repositories.ts`.

### 3.4 Grading Service

New file: `apps/api/src/grading-service.ts`

**Core function:**

```typescript
export interface GradingPassResult {
  attempted: number;
  graded: number;
  skipped: number;        // no result found / no event link
  errors: number;
  details: GradingPickResult[];
}

export interface GradingPickResult {
  pickId: string;
  outcome: 'graded' | 'skipped' | 'error';
  result?: 'win' | 'loss' | 'push';
  reason?: string;
}

export async function runGradingPass(
  repositories: Pick<
    RepositoryBundle,
    | 'picks'
    | 'settlements'
    | 'audit'
    | 'gradeResults'
    | 'participants'
    | 'events'
    | 'eventParticipants'
  >,
): Promise<GradingPassResult>
```

**Algorithm per pick:**
1. Find all picks with `status = 'posted'` and no prior settled/grading record
2. For each pick: resolve event context via the same join used in CLV (`participant_id → event_participants → events`)
3. Check `events.status = 'completed'` — skip if not completed
4. Look up `game_results` for `(event_id, participant_id, pick.market)` — skip if no result
5. Infer selection side via existing `inferSelectionSide(pick.selection)`
6. Call `resolveOutcome(actualValue, pick.line)` from `@unit-talk/domain`
7. Map domain outcome to settlement result: `'WIN' → 'win'`, `'LOSS' → 'loss'`, `'PUSH' → 'push'`
8. Call `recordGradedSettlement()` (see §3.5)
9. Record audit entry with grading provenance

**Idempotency:** Check for existing settlement before writing. If pick already has a `settled` status or an existing settlement record with `source: 'grading'`, skip. Do not double-grade.

**Graceful skips (not errors):**
- No `participant_id` on pick (game-total picks not yet resolvable in V1)
- No event link found (pick submitted before entity resolution ran)
- Event not `completed`
- No `game_results` row for the market
- Pick's `line` is null

**Error conditions (log + continue, do not abort pass):**
- `resolveOutcome` throws
- `recordGradedSettlement` throws
- DB write fails

### 3.5 Internal Settlement Write Path for Grading

Add to `apps/api/src/settlement-service.ts`:

```typescript
export async function recordGradedSettlement(
  pickId: string,
  result: 'win' | 'loss' | 'push',
  gradingContext: {
    actualValue: number;
    marketKey: string;
    eventId: string;
    gameResultId: string;
  },
  repositories: Pick<
    RepositoryBundle,
    | 'picks'
    | 'settlements'
    | 'audit'
    | 'providerOffers'
    | 'participants'
    | 'events'
    | 'eventParticipants'
  >,
): Promise<RecordSettlementResult>
```

- This function **does not** go through the HTTP handler guard
- It **does not** accept `source: 'feed'` — it uses `source: 'grading'` internally
- `settledBy: 'grading-service'`
- `confidence: 'confirmed'`
- Calls `enrichSettlementWithClv()` — same CLV enrichment as manual settlement
- Calls `transitionPickLifecycle()` — same lifecycle transition as manual settlement
- Writes audit entry with `action: 'settlement.graded'` and `gradingContext` in payload

**The HTTP `source: 'feed'` block stays in place.** The guard in `recordPickSettlement()` is not removed. External callers cannot trigger feed-source settlement via the HTTP API. Only the grading service (internal function call) can write graded settlements.

### 3.6 Grading Endpoint

New route in `apps/api/src/server.ts`:

```
POST /api/grading/run
```

- Accepts no body
- Requires operator auth (same pattern as other write endpoints, or API key check)
- Calls `runGradingPass(repositories)`
- Returns `GradingPassResult` as JSON
- Records a `system_runs` row for observability (runType: `'grading'`)

**This is an internal operator endpoint — not a public surface.**

For the initial proof, this endpoint is called manually. Automated scheduling (cron) is out of scope for this lane.

---

## 4. Non-Goals

- **No automatic results ingest from SGO** — the `game_results` table is seeded manually for the initial proof; automatic results ingest is a follow-on T2 lane
- **No results ingest service** — only the grading service and storage schema are in scope; data entry into `game_results` is manual or via a later lane
- **No Discord output from grading** — grading writes to the DB only; Discord pick-result notifications are a separate T2 lane
- **No game totals / moneyline grading in V1** — only player props with a populated `participant_id` are graded; team/game-level markets skip gracefully
- **No batch backfill** — already-settled picks are not re-graded
- **No scheduled automation** — `POST /api/grading/run` is called manually; cron scheduling is a follow-on T3 lane
- **No removal of the `source: 'feed'` HTTP block** — that guard stays; only the internal grading path uses `source: 'grading'`
- **No changes to the ingestor** — results ingest is out of scope
- **No HTML dashboard changes** — `GET /api/operator/picks/:id` already shows settlement result; no new HTML surface required

---

## 5. Implementation Surface

| File | Change |
|------|--------|
| `supabase/migrations/202603200012_game_results.sql` | NEW — `game_results` table + index |
| `packages/db/src/schema.ts` | Add `'grading'` to `settlementSources` |
| `packages/db/src/types.ts` | Add `GradeResultRecord = Tables<'game_results'>` |
| `packages/db/src/repositories.ts` | Add `GradeResultInsertInput`, `GradeResultLookupCriteria`, `GradeResultRepository`; add `gradeResults` slot to `RepositoryBundle` |
| `packages/db/src/runtime-repositories.ts` | `DatabaseGradeResultRepository` + `InMemoryGradeResultRepository` |
| `packages/db/src/index.ts` | Export `GradeResultRecord`, `GradeResultRepository` |
| `apps/api/src/grading-service.ts` | NEW — `runGradingPass()`, `GradingPassResult`, `GradingPickResult` |
| `apps/api/src/grading-service.test.ts` | NEW — unit tests for grading logic |
| `apps/api/src/settlement-service.ts` | Add `recordGradedSettlement()` internal function |
| `apps/api/src/server.ts` | Add `POST /api/grading/run` route; add `gradeResults` to repository bundle |
| `apps/api/src/server.test.ts` | Add grading endpoint tests |

**Do not touch:**
- `packages/domain/src/**` — domain math is already complete; consume, do not modify
- `apps/ingestor/**` — results ingest is out of scope
- `apps/discord-bot/**` — no bot changes
- `apps/smart-form/**` — no Smart Form changes
- `apps/worker/**` — no worker changes
- `packages/db/src/database.types.ts` — regenerate after migration 012 via `pnpm supabase:types`

---

## 6. Acceptance Criteria

| # | Criterion | Testable? |
|---|-----------|-----------|
| AC-1 | Migration 012 applied: `game_results` table exists in live DB with correct columns and unique constraint | ✅ Supabase MCP |
| AC-2 | `GradeResultRepository.insert()` stores a result row; `findResult()` retrieves it by event + participant + market | ✅ Unit test |
| AC-3 | `runGradingPass()` grades a `posted` pick when a matching `game_results` row exists; writes settlement with `source: 'grading'`, correct result, transitions pick to `settled` | ✅ Unit test |
| AC-4 | `runGradingPass()` skips a pick when event is not `completed` — pick remains `posted`, no settlement written | ✅ Unit test |
| AC-5 | `runGradingPass()` skips a pick when no `game_results` row exists — pick remains `posted`, no settlement written | ✅ Unit test |
| AC-6 | `runGradingPass()` is idempotent — running it twice on the same pick does not create a second settlement | ✅ Unit test |
| AC-7 | `recordGradedSettlement()` enriches settlement with CLV (same as manual path) | ✅ Unit test |
| AC-8 | The HTTP settlement handler still rejects `source: 'feed'` with 409 — existing guard unchanged | ✅ Existing test |
| AC-9 | `POST /api/grading/run` returns `GradingPassResult` with correct counts | ✅ Integration test |
| AC-10 | `audit_log` row with `action: 'settlement.graded'` written for each auto-graded pick; includes `gradingContext` in payload | ✅ Unit test |
| AC-11 | `pnpm verify` exits 0; root test count ≥708 (no regression) + ≥10 net-new tests | ✅ CI |
| AC-12 | Existing settlement tests pass — no regression in manual settlement path | ✅ Existing tests |

---

## 7. Proof Requirements (T1)

Before Claude marks this sprint CLOSED, the following must be demonstrated:

1. **`pnpm verify` exits 0** with ≥10 net-new tests
2. **Migration 012 applied**: `game_results` table confirmed in live DB via Supabase MCP
3. **Live grading proof**:
   - Seed one `game_results` row manually (any completed NBA game, one player, one market matching an existing posted pick)
   - OR if no posted pick with a linked event exists: create a proof fixture pick via `POST /api/submissions` then advance to `posted`, seed the result, run grading
   - Call `POST /api/grading/run`
   - Show response: `graded: 1`, `skipped: 0`, `errors: 0`
   - Query `settlement_records` — confirm new row with `source: 'grading'`, correct `result`, non-null `payload.clv`
   - Query `picks` — confirm `status: 'settled'`
   - Query `audit_log` — confirm `action: 'settlement.graded'` row with `gradingContext`
4. **Idempotency**: Call `POST /api/grading/run` a second time — confirm no duplicate settlement created, response shows `graded: 0`
5. **Skip proof**: Confirm that a pick linked to an event with `status: 'scheduled'` (not completed) is skipped, not graded
6. **Feed block unchanged**: Confirm `POST /api/picks/:id/settle` with `source: 'feed'` still returns 409

---

## 8. Blocker Conditions

This contract **cannot be started** if any of the following are true:
- T1 CLV lane is not CLOSED (settlement write path is not stable) — **currently CLOSED ✅**
- T1 Feed Entity Resolution is not CLOSED (no `event_participants` / `events.external_id` data) — **currently CLOSED ✅**
- `pnpm verify` is not currently exiting 0 — **currently 708/708 ✅**

This contract **can be started by Codex immediately after `/pick` closes**, or in parallel with `/pick` if capacity allows (non-overlapping surfaces — `apps/discord-bot` vs `apps/api` + `packages/db`).

---

## 9. Rollback Plan

**Migration 012 rollback:**
```sql
DROP TABLE IF EXISTS game_results;
```
No FKs from other tables point to `game_results` — safe to drop.

**Code rollback:**
1. Delete `apps/api/src/grading-service.ts`
2. Remove `recordGradedSettlement()` from `settlement-service.ts`
3. Remove `POST /api/grading/run` from `server.ts`
4. Remove `GradeResultRepository` from `repositories.ts`, `runtime-repositories.ts`, `index.ts`, `types.ts`
5. Revert `'grading'` from `settlementSources` in `schema.ts`
6. `pnpm verify` — confirm 708 tests pass

**Existing graded settlement records** with `source: 'grading'` are harmless after rollback — they remain in `settlement_records` and correctly represent the settled state of those picks. The settled picks do not revert.

---

## 10. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| No `game_results` rows in live DB — proof requires manual seeding | Medium | Manual seed of one row is sufficient for the proof; instructions in §7 |
| Pick-to-event join fails (no `participant_id`) | Medium | Graceful skip; logged in `GradingPassResult.details` |
| CLV enrichment fails at grading time (no matching offer) | Low | CLV is optional; `payload.clv = null` is valid; settlement still records |
| Double-grading if pass runs concurrently | Low | Idempotency check (existing settlement with `source: 'grading'`) before write; wrap in advisory or check at DB level if needed in follow-on |
| `game_results.actual_value` precision loss for large stat values | Low | `NUMERIC` type in Postgres handles arbitrary precision |

---

## 11. Deferred Items

| Item | When |
|------|------|
| Automatic results ingest from SGO (or secondary provider) | Follow-on T2 lane — adds a results fetcher that populates `game_results` automatically |
| Game total / moneyline grading (no `participant_id`) | Follow-on T3 — extend grading to handle null-participant markets once game-level results are in `game_results` |
| Scheduled grading cron (automatic trigger) | Follow-on T3 — add cron schedule calling `POST /api/grading/run` |
| Discord pick-result notification after grading | Follow-on T2 — Discord bot reaction or message once a grade lands |
| Bulk backfill of historical picks | Maintenance script — not blocking |
