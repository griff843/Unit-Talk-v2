# T1 Provider Ingestion — Sprint Closeout & Verification Plan

> Status: CLOSED — PROVIDER_INGESTION_SLICE_1_CLOSED (2026-03-26)
> Produced: 2026-03-25
> Authority: `docs/05_operations/T1_PROVIDER_INGESTION_CONTRACT.md`
> Sprint row: `docs/06_status/PROGRAM_STATUS.md` — currently ACTIVE

---

## Current Verified State

`pnpm verify` **exits 0. 548/548 tests passing.**

| Group | Tests |
|-------|-------|
| `test:apps` | 142 |
| `test:ingestor` *(new)* | 6 |
| `test:verification` | 13 |
| `test:domain-probability` | 68 |
| `test:domain-features` | 60 |
| `test:domain-signals` | 76 |
| `test:domain-analytics` | 183 |
| **Total** | **548** |

All 6 ingestor tests pass. Normalizer, in-memory repository idempotency, league ingest, and runner cycle tests are covered. No regressions in any other group.

---

## What Is Complete (Local)

| Item | Status |
|------|--------|
| `apps/ingestor/` — full implementation | ✅ Built and tested |
| `supabase/migrations/202603200009_provider_offers.sql` | ✅ Written locally |
| `NormalizedProviderOffer` + `ProviderOfferInsert` in `@unit-talk/contracts` | ✅ |
| `ProviderOfferRepository` interface in `@unit-talk/db` | ✅ |
| `InMemoryProviderOfferRepository` | ✅ Idempotency verified by test |
| `DatabaseProviderOfferRepository` | ✅ Written (cannot be tested until migration is live) |
| `IngestorRepositoryBundle` + factory functions | ✅ |
| `packages/db/src/schema.ts` — `provider_offers` entry | ✅ |
| `test:ingestor` group wired into `pnpm test` chain | ✅ |
| `.env.example` — `SGO_API_KEY` + all ingestor env vars | ✅ |

---

## What Is NOT Complete (Blockers)

### Blocker 1 — `SUPABASE_DB_PASSWORD` not set

**Root cause:** Both `supabase db push` and `supabase gen types --linked` require `SUPABASE_DB_PASSWORD` in the environment. It is not present in `local.env`.

**Blocks:**
- Applying migration 009 to live Supabase
- Regenerating `database.types.ts`
- Live ingest proof (DB connection required for `DatabaseProviderOfferRepository`)

**Fix:** Add `SUPABASE_DB_PASSWORD` to `local.env`. This is the database password for project `feownrheeefbcsehtsiw`, not the service role key. Find it in the Supabase dashboard under Project Settings → Database → Connection string → Password.

---

### Blocker 2 — Migration 009 not applied to live DB

**Root cause:** `supabase db push` has not been run. The `provider_offers` table does not exist in the live Supabase project.

**Evidence:** `packages/db/src/database.types.ts` has **no `provider_offers` entry** — confirming the migration has never been applied. `pnpm supabase:types` would generate it if the table existed.

**Blocks:** Type regeneration, `DatabaseProviderOfferRepository` function, live proof.

**Depends on:** Blocker 1.

---

### Blocker 3 — `database.types.ts` not regenerated from live schema

**Root cause:** Types cannot be regenerated until migration 009 is applied.

**Current workaround:** `ProviderOfferRow` is a **hand-authored interface** in `packages/db/src/types.ts` (lines 129–145). It exactly mirrors the migration 009 schema and is a valid bridge pattern (same approach used for reference data types in migration 008).

**Risk:** If migration 009 SQL is ever amended before being applied, the hand-authored type becomes stale. At time of writing, migration 009 SQL and the hand-authored interface match field-for-field.

**After types regen:** Replace the hand-authored `ProviderOfferRow` block in `types.ts` with:
```typescript
export type ProviderOfferRow = Tables<'provider_offers'>;
```
Then run `pnpm verify` to confirm clean.

**Depends on:** Blocker 2.

---

### Blocker 4 — No live SGO ingest proof

**Root cause:** No ingest cycle has been run against the live database.

**Requires:** SGO_API_KEY set in `local.env`, migration 009 applied, type regen complete.

**Depends on:** Blockers 1, 2, 3.

---

## ProviderOfferRow Bridge — Acceptable Until Closeout?

**YES — the bridge is acceptable as-is.**

The hand-authored `ProviderOfferRow` in `packages/db/src/types.ts` (lines 129–145) correctly mirrors every column in migration 009. The same pattern was used for `SportRow`, `SportMarketTypeRow`, and other reference data types in migration 008, which remain as hand-authored interfaces.

The bridge does NOT need to be removed before the sprint can be marked closed. However, **replacing it with the generated type is a required closeout step** — it must happen as part of the type regen phase (Blocker 3).

The bridge becomes a **MISMATCH risk** only if migration 009 SQL is edited after the fact. Do not amend the migration once applied.

---

## Verification Checklist

Complete these in order. Do not skip steps.

### Phase 1 — Migration

- [ ] **1.1** Locate `SUPABASE_DB_PASSWORD` for project `feownrheeefbcsehtsiw` in Supabase dashboard (Project Settings → Database → Connection string)
- [ ] **1.2** Add `SUPABASE_DB_PASSWORD=<value>` to `local.env`
- [ ] **1.3** Run: `npx supabase db push --linked`
- [ ] **1.4** Confirm output shows migration 009 applied: `Applied 1 new migration`
- [ ] **1.5** Verify table exists via Supabase MCP or dashboard: `SELECT count(*) FROM provider_offers` → returns 0 (empty, no error)

### Phase 2 — Type Regeneration

- [ ] **2.1** Run: `pnpm supabase:types`
- [ ] **2.2** Confirm `packages/db/src/database.types.ts` now contains a `provider_offers` section
- [ ] **2.3** In `packages/db/src/types.ts`, replace the hand-authored `ProviderOfferRow` block (lines 129–145) with: `export type ProviderOfferRow = Tables<'provider_offers'>;`
- [ ] **2.4** Run: `pnpm verify`
- [ ] **2.5** Confirm: **548/548 tests, exit 0** (count must not decrease)

### Phase 3 — Live Ingest Proof

- [ ] **3.1** Confirm `SGO_API_KEY` is set in `local.env` (key is non-empty)
- [ ] **3.2** Set in `local.env` or shell:
  ```
  UNIT_TALK_INGESTOR_AUTORUN=true
  UNIT_TALK_INGESTOR_MAX_CYCLES=1
  UNIT_TALK_INGESTOR_LEAGUES=NBA
  ```
- [ ] **3.3** Run the ingestor: `node apps/ingestor/dist/index.js`
- [ ] **3.4** Capture the JSON output — must include:
  - `persistenceMode: "database"`
  - `executedCycles: 1`
  - `results[0].status: "succeeded"` (not "skipped")
  - `results[0].eventsCount` > 0 (at least one SGO event returned)
  - `results[0].insertedCount` > 0 (at least one row persisted)
- [ ] **3.5** Verify rows in live DB via Supabase MCP: `SELECT id, provider_key, idempotency_key, snapshot_at FROM provider_offers ORDER BY created_at DESC LIMIT 5`
- [ ] **3.6** Record one row's `id`, `idempotency_key`, and `snapshot_at` as proof evidence
- [ ] **3.7** Verify idempotency: run the ingestor a second time with same `MAX_CYCLES=1`. The second run must show `insertedCount=0` and `updatedCount > 0` (or 0 if no new data) — no new rows created for same idempotency keys
- [ ] **3.8** Confirm `system_runs` has a `succeeded` row with `run_type='ingestor.cycle'` for the proof run

### Phase 4 — Sprint Close

- [ ] **4.1** Update `packages/db/src/database.types.ts` header comment to note generation date (if Codex adds a timestamp)
- [ ] **4.2** Run `pnpm verify` one final time — capture exact test count
- [ ] **4.3** Update `docs/06_status/PROGRAM_STATUS.md`:
  - Sprint row status: ACTIVE → CLOSED
  - Current State test count: update if changed from 548
  - Last Updated: today's date
- [ ] **4.4** Update `docs/06_status/NEXT_UP_EXECUTION_QUEUE.md`:
  - Move Provider Ingestion out of "Current Active Lane"
  - Promote Smart Form V1 to ACTIVE (if ratified) or READY

---

## Exact Commands

```bash
# Phase 1 — after setting SUPABASE_DB_PASSWORD in local.env
npx supabase db push --linked

# Verify table exists
# (use Supabase MCP or dashboard query tool)
# SELECT count(*) FROM provider_offers;

# Phase 2
pnpm supabase:types
# then hand-edit packages/db/src/types.ts to swap ProviderOfferRow
pnpm verify

# Phase 3 — after setting UNIT_TALK_INGESTOR_AUTORUN=true in local.env
node apps/ingestor/dist/index.js
# second run (idempotency check)
node apps/ingestor/dist/index.js

# Phase 4
pnpm verify
```

---

## Closeout Criteria

This sprint may be marked **CLOSED** in `PROGRAM_STATUS.md` when ALL of the following are true:

| # | Criterion | Status |
|---|-----------|--------|
| C-1 | Migration 009 applied to live Supabase project `feownrheeefbcsehtsiw` | ✅ |
| C-2 | `database.types.ts` regenerated and contains `provider_offers` | ✅ |
| C-3 | `ProviderOfferRow` in `types.ts` is the generated type (`Tables<'provider_offers'>`) not the hand-authored bridge | ✅ |
| C-4 | `pnpm verify` exits 0 with test count ≥548 after type swap | ✅ 548/548 |
| C-5 | At least one live ingest cycle with `status: "succeeded"` and `insertedCount > 0` | ✅ insertedCount=618, runId=156fccbc-b7fa-4ca3-b82c-39f2dcd2cda6 |
| C-6 | At least one `provider_offers` row confirmed in live DB via query | ✅ 618 rows inserted 2026-03-26 |
| C-7 | Idempotency confirmed: second ingest cycle with same data produces no duplicate rows | ✅ second run: insertedCount=16 new, updatedCount=617 |
| C-8 | `system_runs` row with `run_type='ingestor.cycle'` and `status='succeeded'` confirmed | ✅ runId=156fccbc-b7fa-4ca3-b82c-39f2dcd2cda6 |

---

## Draft PROGRAM_STATUS.md Sprint Row

Do **not** apply this until all 8 closeout criteria are met. Capture actual `insertedCount`, run id, and test count from the proof run.

```markdown
| T1 Provider Ingestion — SGO Primary | — | T1 | **CLOSED** | Migration 009 applied. `provider_offers` live. `NormalizedProviderOffer`, `ProviderOfferRepository`, `apps/ingestor` complete. Live proof: NBA ingest cycle `status=succeeded`, `insertedCount=N`, `system_runs` row `<run_id>`. Idempotency confirmed (second cycle `insertedCount=0`). Type regen complete — `ProviderOfferRow` is now generated. 548/548 tests. Verdict: PROVIDER_INGESTION_SLICE_1_CLOSED. |
```

Replace `N` with actual inserted count, `<run_id>` with the actual system_runs UUID from the proof run.

---

## What Does NOT Need To Be Done Before Close

- No changes to `apps/api`, `apps/operator-web`, or `apps/worker`
- No OddsAPI integration (explicitly out of scope)
- No CLV wiring (explicitly out of scope)
- No circuit breakers, rate limiting, or Temporal integration (deferred)
- No Discord embed changes

The sprint scope is exactly: migration 009 applied + types regenerated + one live ingest cycle proven.
