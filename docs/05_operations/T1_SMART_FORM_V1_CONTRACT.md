# T1 Contract: Smart Form V1 — Capper Conviction Input

> Tier: T1 (user-facing submission surface + promotion scoring path)
> Contract status: **RATIFIED** (corrected 2026-03-26 — prior CLOSED status was premature; capperConviction field is NOT implemented in apps/smart-form as of 2026-03-26)
> Produced: 2026-03-25
> Ratified: 2026-03-26 — T1 Provider Ingestion closed; no prior active T1 lane
> Implementation issue: UTV2-40 (lane:codex)
> Supersedes: none
> Depends on: existing `apps/smart-form`, `apps/api`, `@unit-talk/domain` promotion scoring

---

## 1. Objective

This contract authorizes and defines the Smart Form V1 slice. The slice closes the primary promotion scoring gap for Smart Form submissions: the absence of a capper-supplied conviction signal means all Smart Form picks score ~61.5 — below the Best Bets threshold of ≥70 — and are permanently suppressed regardless of the underlying pick quality.

V1 adds a single required input field (`capperConviction`) to the submission form and maps it into `metadata.promotionScores.trust`, giving the promotion engine a real trust signal derived from capper judgment rather than a null fallback. This is the minimum change that unlocks promotion eligibility for Smart Form submissions without faking scores.

---

## 2. Why This Matters

Smart Form is the only operator-accessible pick submission surface. Every pick submitted via the form today is suppressed at the promotion gate because `metadata.promotionScores` is empty and domain-analysis fallbacks produce a trust score that anchors the composite at ~61.5. A capper submitting a high-conviction pick has no mechanism to express that conviction, and the system has no mechanism to act on it.

This is not a scoring calibration problem — it is a missing input problem. The scoring engine is correct; it simply has no capper-supplied signal to work with. V1 adds that signal with the minimum footprint necessary.

---

## 3. Scope

The following are in scope for this contract:

1. **`capperConviction` form field** — required integer 1–10 (conviction rating); collected in the Smart Form UI; labeled "Conviction (1–10)" with inline help text
2. **Schema update** — `betFormSchema` in `apps/smart-form/lib/form-schema.ts` gains `capperConviction: z.number().int().min(1).max(10)`
3. **Payload mapping** — `buildSubmissionPayload` in `apps/smart-form/lib/form-utils.ts` maps `capperConviction` → `metadata.promotionScores.trust` using the scale: `trust = capperConviction * 10` (range 10–100)
4. **UI integration** — conviction input added to the Stake section in `BetForm.tsx`; rendered as a 1–10 numeric input or slider; inline help text: "How confident are you in this pick? (1 = low, 10 = highest conviction)"
5. **`BetSlipPanel` display** — conviction rating shown in the bet slip summary panel
6. **`SuccessReceipt` display** — conviction rating shown in the post-submit receipt
7. **Tests** — ≥6 new tests: schema validation (min/max/required), payload mapping (trust score derivation), end-to-end assertion that `promotionScores.trust` is present in submitted payload
8. **`pnpm verify` clean** — test count must not decrease; all existing tests must pass

---

## 4. Non-Goals

The following are explicitly out of scope for this contract:

- **Edge score input** — domain analysis already computes edge from odds; do not add a separate edge field
- **Readiness, uniqueness, boardFit inputs** — deferred; these require capper history data or board-state awareness not yet available in V1
- **Auto-calibration of conviction to historical win rate** — deferred; requires capper performance data
- **Confidence field (0–1 decimal)** — `confidence` is an internal submission field, not a form input; the form collects conviction (1–10 UX scale), not `confidence` directly
- **Changes to `apps/api` promotion service** — the promotion engine already reads `metadata.promotionScores.trust`; no changes needed there
- **Changes to schema or migration** — `metadata` is a JSONB column; no migration required
- **Changes to `apps/operator-web`** — no operator surface changes in this contract
- **Changes to the Discord embed format** — conviction is not surfaced in Discord embeds in V1
- **Trust score calibration or band adjustment** — the existing scoring weights are not changed
- **Multi-pick or parlay support** — V1 is single-pick only (as today)
- **Capper authentication or session management** — capper identity is still the `capper` dropdown field

---

## 5. Current Truth

**What exists today:**

| File | Current state |
|------|---------------|
| `apps/smart-form/lib/form-schema.ts` | `betFormSchema` — no conviction field |
| `apps/smart-form/lib/form-utils.ts` | `buildSubmissionPayload` — sets `source: 'smart-form'`, maps form fields; `metadata.promotionScores` is absent |
| `apps/smart-form/app/submit/components/BetForm.tsx` | Renders sport, marketType, bet details, book+odds, stake (units, capper, gameDate) — no conviction input |
| `apps/smart-form/app/submit/components/BetSlipPanel.tsx` | Shows bet summary, submit button — no conviction display |
| `apps/smart-form/app/submit/components/SuccessReceipt.tsx` | Shows post-submit receipt — no conviction display |
| `apps/smart-form/test/form-schema.test.ts` | ≥34 tests — no conviction tests |
| `apps/smart-form/test/form-utils.test.ts` | ≥28 tests — no promotionScores mapping tests |
| `apps/api/src/promotion-service.ts` | `evaluateAllPoliciesEagerAndPersist` — resolves trust from `metadata.promotionScores.trust`, falls back to domain analysis if absent |

**Scoring gap:**

The promotion engine resolves `trust` from `pick.metadata.promotionScores.trust`. When absent, the domain fallback produces a low value that anchors the composite at ~61.5. The Best Bets gate requires ≥70. A capper with 10/10 conviction maps to `trust=100`, which combined with domain-derived edge/readiness should push qualifying submissions above the 70 threshold for high-conviction picks.

---

## 6. Field Specification

### `capperConviction`

| Property | Value |
|----------|-------|
| Type | `number` (integer) |
| Range | 1–10 inclusive |
| Required | Yes — submission is rejected at schema validation if absent |
| UX label | "Conviction (1–10)" |
| UX help text | "How confident are you in this pick? (1 = low, 10 = highest conviction)" |
| UI control | Numeric input (type=number, step=1, min=1, max=10) — or slider equivalent |
| Mapped to | `metadata.promotionScores.trust = capperConviction * 10` |

### Trust score derivation

```
conviction=1  → trust=10
conviction=5  → trust=50
conviction=7  → trust=70
conviction=8  → trust=80   ← trader-insights trust threshold
conviction=9  → trust=90
conviction=10 → trust=100
```

The trust threshold for Trader Insights is 85. Conviction ≥9 produces trust=90, clearing the Trader Insights bar. Conviction ≥7 produces trust=70, contributing to Best Bets clearance when combined with domain edge and readiness.

This is a linear mapping. No calibration or capping is applied in V1.

### Payload shape after V1

```typescript
// metadata.promotionScores after buildSubmissionPayload with conviction=8:
{
  trust: 80
  // edge is still absent — derived by domain analysis at submission time
  // readiness, uniqueness, boardFit absent — engine uses fallbacks
}
```

---

## 7. Write Authority and Lifecycle Boundaries

- **`apps/smart-form`** — write authority for all V1 changes. Form, schema, utilities, tests.
- **`apps/api`** — no changes. The promotion service already reads `metadata.promotionScores.trust`; if present, it uses it; if absent, it falls back. No gateway or mapping changes needed.
- **`@unit-talk/db`, `@unit-talk/domain`, `@unit-talk/contracts`** — no changes.
- **Supabase schema** — no migration required. `picks.metadata` is JSONB; the new key writes through without schema change.
- **Single-writer discipline** — maintained. `apps/api` remains the only DB writer. Smart Form posts to `apps/api` via fetch, as today.

**Lifecycle interaction:**

Smart Form V1 does not change any lifecycle state transitions. The path remains:
```
Smart Form POST → apps/api POST /api/submissions
  → submission-service: validate, create CanonicalPick (lifecycleState=validated)
  → promotion-service: evaluate policies — NOW WITH trust signal from promotionScores.trust
  → distribution-service: enqueue if qualified
  → worker → Discord delivery
```

The only change at the API layer is that `picks.metadata.promotionScores.trust` is now populated for Smart Form submissions. The promotion service reads it as a first-priority trust signal without any code change.

---

## 8. What Is Visible in UI vs Hidden System Metadata

| Data | UI visible | Hidden |
|------|-----------|--------|
| Conviction rating (1–10) | ✅ Form input, bet slip panel, success receipt | — |
| Derived trust score (10–100) | ❌ | ✅ Stored in `metadata.promotionScores.trust` |
| Promotion decision (qualified/suppressed) | ❌ | ✅ Stored in `pick_promotion_history` |
| Composite score | ❌ | ✅ Stored in `picks.promotion_score` |
| `source: 'smart-form'` | ❌ | ✅ API-enforced, not editable |

The capper sees their conviction input and the submitted bet details. They do not see promotion scores, trust derivations, or routing decisions — these are system metadata.

---

## 9. Missing / Absent Input Handling

**Conviction is required.** The schema rejects submission if `capperConviction` is absent or out of range. This means:
- There is no fallback conviction value
- There is no "skip conviction" path
- A submission with no conviction input does not reach `apps/api`

**Rationale:** The purpose of V1 is to solve the missing-input problem honestly. Providing a default conviction (e.g., "5") would silently anchor every submission at trust=50 — not substantially different from the current broken state. Requiring the field ensures the capper always signals intent.

**For `edge`, `readiness`, `uniqueness`, `boardFit`:** These remain absent from the Smart Form payload in V1. The promotion engine continues to use domain-analysis fallbacks for edge and readiness, and its existing defaults for uniqueness and boardFit. This is unchanged behavior — only trust is added in V1.

---

## 10. Acceptance Criteria

All of the following must be satisfied before implementation is complete:

| # | Criterion | Testable? |
|---|-----------|-----------|
| AC-1 | `betFormSchema` rejects payloads where `capperConviction` is absent | ✅ Unit test |
| AC-2 | `betFormSchema` rejects `capperConviction < 1` | ✅ Unit test |
| AC-3 | `betFormSchema` rejects `capperConviction > 10` | ✅ Unit test |
| AC-4 | `betFormSchema` rejects non-integer conviction (e.g., 7.5) | ✅ Unit test |
| AC-5 | `buildSubmissionPayload` maps `capperConviction=8` → `metadata.promotionScores.trust=80` | ✅ Unit test |
| AC-6 | `buildSubmissionPayload` maps `capperConviction=1` → `metadata.promotionScores.trust=10` | ✅ Unit test |
| AC-7 | `buildSubmissionPayload` maps `capperConviction=10` → `metadata.promotionScores.trust=100` | ✅ Unit test |
| AC-8 | `metadata.promotionScores.trust` is present in the submitted payload for any valid conviction | ✅ Unit test |
| AC-9 | Conviction input is present in `BetForm` render output (UI component test or visual confirmation) | ✅ Manual / component test |
| AC-10a | `pnpm verify` exits 0 with root test count ≥548 — no regression in any root-verified package | ✅ CI |
| AC-10b | `pnpm --filter @unit-talk/smart-form test` exits 0 with ≥6 net-new tests vs pre-V1 baseline (≥62 → actual 112) | ✅ Package-local CI |
| AC-11 | Existing Smart Form tests unchanged — no regressions in `form-schema.test.ts` or `form-utils.test.ts` | ✅ CI |

> **Note (2026-03-26):** AC-10 was originally written as a single root-verify count criterion (≥554). This was a contract authoring error. `apps/smart-form` tests have never been part of root `pnpm test` — they run via a package-local script only. AC-10 was amended to AC-10a/AC-10b to accurately reflect the two governed verification surfaces. Both are met. No implementation scope was opened to resolve this. |

---

## 11. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Cappers treat conviction as arbitrary and enter 10 for everything | Medium | Accepted for V1 — calibration requires historical data; score inflation is visible in `pick_promotion_history` and correctable in a follow-up contract |
| Trust score of 100 alone does not clear Best Bets (≥70 composite requires multiple components) | Low | Conviction=7 (trust=70) combined with domain-derived edge ≥30 and readiness ≥30 should produce composite ≥70; this is a property of the existing scorer and is not changed here |
| Users misinterpret conviction as "confidence in outcome" (gambling sense) vs "analytical conviction" | Medium | Inline help text required: "How confident are you in this pick?" — not "How likely is this to win?" |
| Conviction field blocks submission for users unfamiliar with it | Low | Field has clear 1–10 range and label; no ambiguity in expected format |
| `metadata.promotionScores` key collides with a future schema change | Low | `promotionScores` key is established in `@unit-talk/contracts` pattern; no collision risk in V1 scope |

**Known limitation:** Even with V1 deployed, a pick with conviction=7 (trust=70) may still not clear Best Bets if the domain-derived edge and readiness are low. This is correct behavior — high conviction does not override poor analytical signals. The fix is honest: conviction is one input, not a bypass.

---

## 12. Implementation Slice — Files Changed

Codex should touch only these files:

| File | Change |
|------|--------|
| `apps/smart-form/lib/form-schema.ts` | Add `capperConviction: z.number().int().min(1).max(10)` |
| `apps/smart-form/lib/form-utils.ts` | Map conviction → `metadata.promotionScores.trust` in `buildSubmissionPayload` |
| `apps/smart-form/app/submit/components/BetForm.tsx` | Add conviction input in Stake section |
| `apps/smart-form/app/submit/components/BetSlipPanel.tsx` | Add conviction display |
| `apps/smart-form/app/submit/components/SuccessReceipt.tsx` | Add conviction display |
| `apps/smart-form/test/form-schema.test.ts` | Add ≥4 conviction validation tests |
| `apps/smart-form/test/form-utils.test.ts` | Add ≥3 trust mapping tests |

**Do not touch:**
- `apps/api/**` — no changes
- `packages/**` — no changes
- Any operator or worker surface

---

## 13. Rollback Plan

Smart Form V1 is a form-layer change only. Rollback is:

1. Revert `apps/smart-form/lib/form-schema.ts` — remove `capperConviction`
2. Revert `apps/smart-form/lib/form-utils.ts` — remove trust mapping
3. Revert `BetForm.tsx`, `BetSlipPanel.tsx`, `SuccessReceipt.tsx` — remove conviction UI
4. `pnpm verify` — confirm 548/548 root tests pass (pre-V1 root baseline; Smart Form package tests are package-local only)
5. `pnpm --filter @unit-talk/smart-form test` — confirm package reverts to pre-V1 baseline (≥62 tests, no conviction tests)

No DB migration to roll back. No `apps/api` changes to revert. Rollback is fully contained in `apps/smart-form`.

---

## 14. Proof Requirements (T1)

Before Claude closes this sprint, the following must be demonstrated:

1. `pnpm verify` exits 0 with test count ≥554
2. A Smart Form submission with conviction=8 produces a pick row where `metadata.promotionScores.trust = 80` — verified via Supabase MCP or `GET /api/operator/picks/:id`
3. A Smart Form submission with conviction=9 is evaluated for Trader Insights eligibility (trust=90 ≥ 85 threshold) — the promotion history row reflects the correct policy evaluation
4. A Smart Form submission with conviction=4 (trust=40) is suppressed — `pick.promotion_status = 'not_eligible'` or composite score < 70
5. No regressions in any existing Smart Form test

---

## 16. T3 Lane Engineering Constraints (Smart Form Surface)

These constraints apply to all future T3 (and Augment-lane) work touching `apps/smart-form`, regardless of whether a separate T3 contract exists. They are not T1-specific — they govern the surface.

### Rule 1 — Pure Helper Placement

**Helpers that must be importable outside the Next.js component runtime must live in `apps/smart-form/lib/`, not in component files.**

Component files under `apps/smart-form/app/**/*.tsx` (e.g., `BetForm.tsx`, `BetSlipPanel.tsx`) transitively import Next.js UI dependencies (`@/components/ui/*`, `next/*`, `react-hook-form`) that cannot be resolved by `tsx --test` or the root `pnpm test` runner. Exporting a helper from one of these files silently breaks any consumer that runs outside the Next.js Jest environment — even if the package-local jest suite passes.

A "helper importable outside Next.js component runtime" is any function that:
- is tested by `tsx --test` (any file in the root test suite)
- is imported by another package
- is referenced in integration test assertions

### Rule 2 — Test Runner Verification

**Package-local jest (`pnpm --filter @unit-talk/smart-form test`) is not sufficient proof for helpers that tsx --test consumers will import.**

The package-local jest runs under the Next.js jest config which resolves `@/` aliases and mocks Next.js internals. It will pass for helpers exported from component files. The root runner (`tsx --test`) does not resolve these aliases and will fail at import.

Required gate for smart-form T3 lanes that deliver helpers:

```bash
# Verify helper is importable by tsx --test (root integration surface)
tsx --test apps/smart-form/test/<test-file>.test.ts

# Then verify package-local suite still passes
pnpm --filter @unit-talk/smart-form test
```

Both must pass. Jest alone is not sufficient where tsx --test compatibility matters.

### Correct vs Incorrect Pattern

```
CORRECT (UTV2-45 post-fix):
  lib/participant-search.ts  ← pure helper, no UI deps
  test/api-client.test.ts    ← imports from lib/participant-search.ts
  Gate: tsx --test apps/smart-form/test/api-client.test.ts  ✅

WRONG (UTV2-45 original Augment submission):
  app/submit/components/BetForm.tsx  ← helper exported from component file
  test/api-client.test.ts            ← imports from BetForm.tsx
  Gate: pnpm --filter @unit-talk/smart-form test  ✅ (misleading — jest resolves @/ aliases)
  Gate: tsx --test apps/smart-form/test/api-client.test.ts  ❌ (cannot find @/components/ui/form)
```

### Where to put new helpers

| Helper type | Location |
|-------------|----------|
| Pure business logic (URL builders, data normalizers, validators) | `apps/smart-form/lib/` |
| Form schema | `apps/smart-form/lib/form-schema.ts` |
| Form-to-payload mapping | `apps/smart-form/lib/form-utils.ts` |
| API client calls | `apps/smart-form/lib/api-client.ts` |
| UI-only logic (render, state, event handlers with no external consumers) | Component file — OK, but do not export for external use |

---

## 15. Deferred Items (Do Not Include in V1)

| Item | When |
|------|------|
| Edge input field (capper-supplied edge %) | Future contract — domain edge is sufficient in V1 |
| Readiness score input | Future contract — requires capper context |
| Uniqueness score input | Future contract — requires board awareness |
| Conviction history tracking per capper | Future — requires capper performance DB |
| Conviction calibration (conviction vs actual win rate) | Syndicate-gate work |
| Conviction displayed in Discord embed | Future embed contract |
| Conviction visible in Command Center | Future operator contract |
| "I know something the market doesn't" signal | Future — qualitative signal layer |
