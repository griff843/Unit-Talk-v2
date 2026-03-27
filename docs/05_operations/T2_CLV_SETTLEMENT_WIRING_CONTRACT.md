# T2 Contract: CLV Wiring into Graded Settlement Payload

> **Status:** RATIFIED
> **Tier:** T2 — additive payload fields; no migration (JSONB); no settlement path restructure
> **Lane:** `lane:codex` (implementation), `lane:claude` (verification)
> **Issue:** UTV2-46
> **Predecessor:** UTV2-28 T1 Automated Grading — CLOSED ✅; CLV service (`clv-service.ts`) exists
> **Ratified:** 2026-03-27

---

## 1. Problem Statement

`apps/api/src/settlement-service.ts` calls `resolveClvPayload()` during graded settlement. That function fetches the closing line from `provider_offers` and stores the raw line data as a nested key:

```json
{
  "gradingContext": { "actualValue": 31, "marketKey": "points-all-game-ou", ... },
  "correction": false,
  "clv": {
    "providerKey": "sgo",
    "line": 28.5,
    "overOdds": -115,
    "underOdds": -105,
    "snapshotAt": "2026-03-26T23:00:00Z"
  }
}
```

But `GET /api/operator/stats` and `GET /api/operator/leaderboard` read CLV data from top-level payload keys:

```
settlement_records.payload->>'clvRaw'           (CLV % — implied prob delta)
settlement_records.payload->>'beatsClosingLine' (boolean string)
```

These keys are never written, so `avgClvPct` and `beatsLine` are always `null` in stats and leaderboard responses. The CLV computation already exists in `apps/api/src/clv-service.ts` (`computeAndAttachCLV`) but is never called from the graded settlement path.

---

## 2. Fix

In `recordGradedSettlement()`, call `computeAndAttachCLV` from `clv-service.ts` and write the computed values as **top-level payload keys** alongside the existing `gradingContext` and `clv` keys.

**Target payload shape after fix:**

```json
{
  "gradingContext": { "actualValue": 31, "marketKey": "points-all-game-ou", "eventId": "...", "gameResultId": "..." },
  "correction": false,
  "clv": {
    "providerKey": "sgo",
    "line": 28.5,
    "overOdds": -115,
    "underOdds": -105,
    "snapshotAt": "2026-03-26T23:00:00Z"
  },
  "clvRaw": 0.032,
  "clvPercent": 3.2,
  "beatsClosingLine": true
}
```

`clvRaw` and `beatsClosingLine` are now top-level — readable by `payload->>'clvRaw'` and `payload->>'beatsClosingLine'`.

---

## 3. Implementation

### 3.1 Modified File: `apps/api/src/settlement-service.ts`

In `recordGradedSettlement()`, replace or supplement `resolveClvPayload` with a call to `computeAndAttachCLV`:

```typescript
import { computeAndAttachCLV } from './clv-service.js';

// In recordGradedSettlement():
const clvResult = await computeAndAttachCLV(pick, repositories);

const payload: Record<string, unknown> = {
  gradingContext,
  correction: false,
};

if (clvResult) {
  payload['clv'] = {
    providerKey: clvResult.providerKey,
    line: clvResult.closingLine,
    overOdds: clvResult.closingOdds,
    snapshotAt: clvResult.closingSnapshotAt,
  };
  payload['clvRaw'] = clvResult.clvRaw;
  payload['clvPercent'] = clvResult.clvPercent;
  payload['beatsClosingLine'] = clvResult.beatsClosingLine;
}
```

**Remove** `resolveClvPayload` (it is replaced by `computeAndAttachCLV`). If any tests reference `resolveClvPayload` directly, remove those tests.

The `repositories` signature for `recordGradedSettlement` already includes `eventParticipants` — this is required by `computeAndAttachCLV`. Confirm it's present; add if missing.

### 3.2 No Other Files Change

- No schema migration — `settlement_records.payload` is JSONB; new top-level keys write through
- No changes to `clv-service.ts` — `computeAndAttachCLV` is used as-is
- No changes to `grading-service.ts` — it calls `recordGradedSettlement`, unchanged interface
- No changes to stats or leaderboard endpoints — they already read the right keys

---

## 4. Current State Reference

| Location | Current | After Fix |
|---|---|---|
| `settlement_records.payload.clvRaw` | missing | `number` (implied prob delta, e.g. `0.032`) |
| `settlement_records.payload.beatsClosingLine` | missing | `boolean` |
| `settlement_records.payload.clvPercent` | missing | `number` (e.g. `3.2`) |
| `settlement_records.payload.clv` | `{ providerKey, line, overOdds, underOdds, snapshotAt }` | same (unchanged for backward compat) |
| `/stats` avgClvPct | always `null` | populated when closing line found |
| `/leaderboard` avgClvPct | always `null` | populated when closing line found |

---

## 5. Acceptance Criteria

| # | Criterion | Testable? |
|---|-----------|-----------|
| AC-1 | `settlement_records.payload` for a graded settlement includes `clvRaw` (number) when a closing line exists | ✅ Unit test (InMemory with seeded provider_offers) |
| AC-2 | `settlement_records.payload.beatsClosingLine` is `true` when pick odds beat closing line, `false` otherwise | ✅ Unit test |
| AC-3 | When no closing line exists (no matching provider_offer), `clvRaw` and `beatsClosingLine` are absent from payload | ✅ Unit test |
| AC-4 | `resolveClvPayload` is removed or no longer called | ✅ Code review |
| AC-5 | `GET /api/operator/stats` returns non-null `avgClvPct` for a graded pick with a matching closing line (live DB) | ✅ Live DB verify |
| AC-6 | `pnpm verify` exits 0; ≥4 net-new tests; total ≥ 602 (598 baseline) |✅ CI |

---

## 6. Tests Required

### settlement-service tests (≥4)

1. `recordGradedSettlement` — pick with matching closing line → `payload.clvRaw` populated (number)
2. `recordGradedSettlement` — pick with matching closing line → `payload.beatsClosingLine` is `true` when pick implied > closing implied
3. `recordGradedSettlement` — pick with matching closing line → `payload.beatsClosingLine` is `false` when pick implied < closing implied
4. `recordGradedSettlement` — pick with no matching closing line → `clvRaw` absent from payload (graceful null case)

**Note:** These require seeding `InMemoryProviderOfferRepository` with a closing line. Look at `clv-service.test.ts` for the seeding pattern — it already seeds provider offers for unit tests.

---

## 7. Proof Requirements

- [ ] `pnpm verify` exits 0; test count ≥ 602
- [ ] Run `POST /api/grading/run` against live DB — confirm a settlement record's payload now includes `clvRaw` (requires a pick with `participant_id` linked to an event with a matching `provider_offers` closing line)
- [ ] `GET /api/operator/stats` returns non-null `avgClvPct` for at least one capper (requires picks with CLV data)

---

## 8. Out of Scope

- Backfilling existing `settlement_records` with CLV data (historical picks)
- Changes to the CLV computation algorithm (use `computeAndAttachCLV` as-is)
- `clv-service.ts` modifications
- Stats/leaderboard endpoint changes (already read the right keys)
- Any new `provider_offers` ingestion (SGO ingest covers this in UTV2-30)

---

## 9. Dependency Chain

- UTV2-28 (T1 Automated Grading) — **CLOSED** ✅
- UTV2-30 (T2 SGO Results Ingest) — **CLOSED** ✅ — `provider_offers` populated
- UTV2-46 (this implementation) — **READY** upon this contract ratification
