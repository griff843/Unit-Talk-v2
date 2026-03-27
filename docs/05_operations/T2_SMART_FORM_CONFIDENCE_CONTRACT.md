# T2 Contract: Smart Form Confidence Field

> **Status:** RATIFIED
> **Tier:** T2 — additive field; no migration; no settlement path change
> **Lane:** `lane:codex` (implementation), `lane:claude` (verification)
> **Issue:** UTV2-49
> **Companion:** UTV2-48 — CLV Wiring Live Proof (T1 verify, `lane:claude`)
> **Ratified:** 2026-03-27

---

## 1. Problem Statement

`buildSubmissionPayload()` in `apps/smart-form/lib/form-utils.ts` does not set the `confidence` field. It sets `metadata.promotionScores.trust = capperConviction * 10` but omits the top-level `confidence` key.

`confidence` is a 0–1 float in `SubmissionPayload` (`packages/contracts/src/submission.ts`). It is used by `evaluateEdge()` in `@unit-talk/domain` as the primary signal for the `edge` promotion score component. When absent, `edge` evaluates to a weak/zero value.

Effect on composite promotion score with `confidence` missing (conviction=8, trust=80):

| Component | Expected | Actual (missing confidence) |
|---|---|---|
| edge | ~80 | ~0–30 (no confidence signal) |
| trust | 80 | 80 ✓ |
| readiness | computed | computed |
| uniqueness | computed | computed |
| boardFit | computed | computed |
| **composite** | **~73 (eligible)** | **~61.5 (not eligible)** |

All Smart Form submissions currently score below the best-bets threshold of 70.00. None reach `discord:best-bets` regardless of conviction.

---

## 2. Fix

### 2.1 `apps/smart-form/lib/api-client.ts`

Add `confidence?: number` to `SubmitPickPayload`:

```typescript
export interface SubmitPickPayload {
  source: string;
  submittedBy?: string;
  market: string;
  selection: string;
  line?: number;
  odds?: number;
  stakeUnits?: number;
  confidence?: number;   // ← ADD
  eventName?: string;
  metadata?: Record<string, unknown>;
}
```

### 2.2 `apps/smart-form/lib/form-utils.ts`

In `buildSubmissionPayload()`, add `confidence: values.capperConviction / 10` to the returned object:

```typescript
export function buildSubmissionPayload(values: BetFormValues): SubmitPickPayload {
  const marketLabel = MARKET_TYPE_LABELS[values.marketType];
  const market = `${values.sport} - ${marketLabel}`;
  const selection = buildSelectionString(values);
  const trustScore = values.capperConviction * 10;

  return {
    source: 'smart-form',
    submittedBy: values.capper,
    market,
    selection,
    line: values.line,
    odds: values.odds,
    stakeUnits: values.units,
    confidence: values.capperConviction / 10,   // ← ADD
    eventName: values.eventName,
    metadata: {
      // ... unchanged ...
    },
  };
}
```

**Mapping:** `capperConviction` is an integer 1–10. Dividing by 10 yields a 0.1–1.0 float matching the `confidence` contract type.

---

## 3. Acceptance Criteria

- [ ] AC-1: `SubmitPickPayload.confidence` field added to `api-client.ts`
- [ ] AC-2: `buildSubmissionPayload()` sets `confidence = capperConviction / 10` for all inputs
- [ ] AC-3: conviction=1 → `confidence=0.1`; conviction=8 → `confidence=0.8`; conviction=10 → `confidence=1.0`
- [ ] AC-4: `metadata.promotionScores.trust` continues to equal `capperConviction * 10` (unchanged)
- [ ] AC-5: `pnpm verify` exits 0; test count ≥ 624 (621 current + ≥3 new `confidence` assertions)
- [ ] AC-6: New tests run via `tsx --test apps/smart-form/test/form-utils.test.ts` (not just jest)

---

## 4. Implementation Scope

### Files to modify

| File | Change |
|---|---|
| `apps/smart-form/lib/api-client.ts` | Add `confidence?: number` to `SubmitPickPayload` |
| `apps/smart-form/lib/form-utils.ts` | Add `confidence: values.capperConviction / 10` to return value |
| `apps/smart-form/test/form-utils.test.ts` | Add ≥3 test cases for `confidence` field |

### Files explicitly NOT touched

- `apps/smart-form/app/**` — no UI/component changes
- `packages/contracts/src/submission.ts` — `confidence` field already exists there
- `supabase/migrations/` — no migration required (field passes through JSONB `metadata`)
- `apps/api/src/` — no API changes required

### T3 Engineering Constraints (smart-form surface)

Per `docs/05_operations/T1_SMART_FORM_V1_CONTRACT.md §16`:

1. All helpers touched in this sprint are already in `apps/smart-form/lib/` — compliant.
2. Codex must run `tsx --test apps/smart-form/test/form-utils.test.ts` directly, not only `pnpm --filter @unit-talk/smart-form test`, to confirm the new tests pass under `tsx`.

---

## 5. Test Requirements

Minimum 3 new test cases in `apps/smart-form/test/form-utils.test.ts` within the `buildSubmissionPayload` describe block:

```
conviction=8 → confidence=0.8
conviction=1 → confidence=0.1
conviction=10 → confidence=1.0
```

All existing tests must continue to pass.

---

## 6. Rollback Plan

`buildSubmissionPayload()` adds an optional key. If the field causes issues downstream, remove `confidence: values.capperConviction / 10` from `form-utils.ts` and `confidence?: number` from `api-client.ts`. No migration, no data to clean up.

---

## 7. Proof Requirements

- [ ] `pnpm verify` exits 0
- [ ] `tsx --test apps/smart-form/test/form-utils.test.ts` exits 0
- [ ] Test count ≥ 624 (net-new ≥ 3 tests)
- [ ] Live submission with conviction=8 → pick `metadata.confidence` = `0.8` in Supabase (Claude verification)

---

## 8. Companion: UTV2-48 CLV Wiring Live Proof

UTV2-46 (merged 2026-03-27) wired `computeAndAttachCLV()` into `recordGradedSettlement()`. No post-merge graded settlements exist yet — all 3 settlements in DB predate the merge.

UTV2-48 (T1 verify, `lane:claude`) is the live proof obligation:

**Goal:** Trigger a grading run against a posted pick that has a matching `provider_offers` row. Verify the resulting `settlement_records.payload` contains top-level `clvRaw`, `clvPercent`, `beatsClosingLine` keys.

**Matching requirements for CLV to fire:**
- `pick.odds` must be a finite number
- `pick.selection` must contain "over" or "under" (for `inferSelectionSide`)
- `pick.participant_id` → participant `external_id` → event `external_id` (entity resolution chain)
- `provider_offers` row must exist with `provider_event_id` + normalized market + participant `external_id` + `snapshot_at < event start`

UTV2-48 is listed as READY in ISSUE_QUEUE.md and opens after UTV2-49 closes. It does not block UTV2-49 implementation.
