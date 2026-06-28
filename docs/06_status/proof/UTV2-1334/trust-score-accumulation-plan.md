# UTV2-1334 — Trust Score Corpus Accumulation Plan

**Issue:** UTV2-1334  
**Tier:** T2  
**Milestone:** M4 — Internal Evidence-Flow Proof  
**Lane type:** Planning / proof only. No code changes. No certification changes. No public claims.  
**Date:** 2026-06-28

---

## 1. Trust Score Mechanism

Trust score in Unit Talk V2 is computed by `computeClvTrustAdjustment` in
`apps/api/src/clv-feedback.ts`. It produces a ±10 point adjustment to the
base trust input used in promotion scoring (`packages/domain/src/promotion.ts`).

**How it works:**
1. Loads the last 30 days of grading settlements from `settlement_records`
   where `source = 'grading'`.
2. For each settlement, loads the associated pick and matches it to the
   capper via `pick.metadata.capper` (primary) or `pick.source` (fallback).
3. Extracts `clvPercent` from the settlement payload (set by the CLV service
   when a closing line exists in `provider_offer_history`).
4. Returns `null` (no adjustment, trust score unchanged) when
   `clvValues.length < minSampleSize`. The current `minSampleSize` is **10**.

```typescript
// clv-feedback.ts line 31
const minSampleSize = options?.minSampleSize ?? 10;
...
if (clvValues.length < minSampleSize) {
  return null;
}
```

A `null` return means trust-score adjustment is disabled for that capper —
the promotion pipeline runs with an unadjusted trust input.

---

## 2. Current State (queried 2026-06-28)

### Registered Cappers

| capper_id | display_name | active |
|-----------|-------------|--------|
| griff843  | griff843    | true   |

**One capper registered. One capper needs to reach the 10-settlement threshold.**

### Settled Picks by Capper

```sql
SELECT capper_id, COUNT(*) as settled_count
FROM picks WHERE status = 'settled'
GROUP BY capper_id ORDER BY settled_count DESC;
```

| capper_id | settled_count |
|-----------|--------------|
| NULL      | 7,508        |
| griff843  | 6            |

- 7,508 settled picks have no `capper_id` set (mostly system-pick-scanner and
  untagged smart-form submissions).
- griff843 has 6 settled picks — 4 below the 10-settlement threshold.

### CLV Computation Status (all settlement_records)

```sql
SELECT payload->>'clvStatus' as clv_status, COUNT(*) as count
FROM settlement_records WHERE status = 'settled'
GROUP BY payload->>'clvStatus' ORDER BY count DESC;
```

| clv_status              | count  |
|------------------------|--------|
| NULL (no CLV attempt)  | 9,653  |
| missing_event_context  | 3,771  |
| computed               | 1,052  |
| missing_closing_line   | 231    |
| missing_priced_side    | 55     |
| missing_selection_side | 1      |

**1,052 picks have `clvStatus = 'computed'`** (closing line found and CLV resolved).

### CLV Settlements Per Capper (effective count for trust-score)

```sql
SELECT p.capper_id, p.source, COUNT(*) as picks,
       COUNT(CASE WHEN p.status = 'settled' THEN 1 END) as settled,
       COUNT(CASE WHEN sr.id IS NOT NULL AND sr.payload->>'clvPercent' IS NOT NULL
                  THEN 1 END) as clv_computed
FROM picks p
LEFT JOIN settlement_records sr ON sr.pick_id = p.id AND sr.source = 'grading'
WHERE p.capper_id = 'griff843' OR p.source = 'smart-form'
GROUP BY p.capper_id, p.source;
```

| capper_id | source      | picks  | settled | clv_computed |
|-----------|-------------|--------|---------|--------------|
| griff843  | smart-form  | 12     | 6       | **0**        |
| NULL      | smart-form  | 27,764 | 4,194   | 299          |

**griff843 currently has 0 CLV-computed settlements.** The trust-score
function returns `null` for griff843 — no trust adjustment is applied.

### Capper Tagging Status

```sql
SELECT COUNT(*) as total_smart_form,
       COUNT(CASE WHEN metadata->>'capper' IS NOT NULL THEN 1 END) as with_capper_tag
FROM picks WHERE source = 'smart-form';
```

| total_smart_form | with_capper_tag |
|-----------------|----------------|
| 27,038          | **0**          |

**No picks have `metadata.capper` set.** This is the primary root cause: the
trust-score lookup `pick.metadata.capper === submittedBy` never matches,
and the fallback `pick.source === 'griff843'` also never matches (source is
`'smart-form'`, not `'griff843'`). All 1,052 CLV-computed settlements are
unreachable by the per-capper trust lookup.

---

## 3. Gap Analysis

| Metric                              | Current | Threshold |
|------------------------------------|---------|-----------|
| Active cappers                      | 1       | ≥1        |
| griff843 settled picks              | 6       | —         |
| griff843 CLV-computed settlements   | **0**   | **10**    |
| Smart-form picks with capper tag    | **0**   | 12+       |
| market_family_trust rows            | **0**   | ≥1        |

**Shortfall: 10 CLV-computed settlements needed, 0 exist for griff843.**

Two independent blockers prevent reaching threshold:

1. **Blocker A — Missing capper tag**: `metadata.capper` is never set on
   smart-form submissions. The trust-score lookup cannot attribute any CLV
   settlement to griff843.

2. **Blocker B — Low capper pick volume**: griff843 has only 12 picks total
   (6 settled), which is insufficient corpus volume even if tagging were fixed.

---

## 4. Accumulation Path

### Step 1 — Fix Capper Tagging (prerequisite, out-of-scope for this lane)

**What must change (separate code lane):**
When griff843 submits a pick via smart-form, the submission payload must
include `metadata.capper = 'griff843'` (or the submitting user's capper ID).

Relevant path: `apps/smart-form/lib/form-utils.ts`

The trust-score function already has the right logic; the data must flow
correctly. No changes to `clv-feedback.ts` are needed.

### Step 2 — Increase Submission Rate

**Target: 3–5 picks per day from griff843 via smart-form.**

At that rate, with sports active (MLB daily, NBA/NHL seasonal):
- ~20–35 picks per week
- Settlement lag: 1–3 days (same-day or next-day for most MLB games)
- CLV computation success rate: ~27% historically (1,052 computed / 3,909
  resolved attempts), rising as `provider_offer_history` coverage improves.

**Conservative projection (27% CLV success rate):**

| Week | New Picks | New Settlements | CLV Computed (27%) | Cumulative CLV |
|------|-----------|----------------|-------------------|----------------|
| 1    | 21        | 15             | 4                 | 4              |
| 2    | 21        | 18             | 5                 | 9              |
| 3    | 21        | 18             | 5                 | **14** ✓       |

**Projected time to threshold: 2–3 weeks** from when capper tagging is fixed
and griff843 submits picks at 3/day minimum.

**Optimistic projection (40% CLV success rate as odds coverage improves):**

| Week | New Picks | New Settlements | CLV Computed (40%) | Cumulative CLV |
|------|-----------|----------------|-------------------|----------------|
| 1    | 21        | 15             | 6                 | 6              |
| 2    | 21        | 18             | 7                 | **13** ✓       |

**Projected time: 1–2 weeks.**

### Step 3 — CLV Computation Preconditions

CLV computation requires a closing line in `provider_offer_history` for the
pick's `(providerEventId, providerMarketKey, providerParticipantId)` tuple.

Currently 7.3% of settled picks have no event context (`missing_event_context`
is the dominant failure). For griff843's picks to have CLV computed:
- Pick must have valid `eventStartTime` and SGO event ID in metadata
- SGO must have ingested odds for the event before game start
- The ingestor must be cycling cleanly (confirmed operational post-UTV2-1315)

### Step 4 — Settlement Cadence

Picks go `posted → settled` when the grading service runs and `game_results`
are present. Based on the last 14 days:

```
Average daily settlements: 98/day (range 31–398)
```

For griff843's specific picks, settlement happens when:
1. The game completes
2. `game_results` contains the outcome
3. `runGradingPass` processes the pick (runs continuously via worker)

Expected settlement lag: **12–36 hours** from game start for MLB (same-day
scoring, settled by next morning).

---

## 5. Monitoring Query

Run this query to check threshold progress:

```sql
SELECT COUNT(*) as clv_settled_count
FROM picks p
JOIN settlement_records sr ON sr.pick_id = p.id
WHERE sr.source = 'grading'
  AND sr.payload->>'clvPercent' IS NOT NULL
  AND (
    p.metadata->>'capper' = 'griff843'
    OR p.source = 'griff843'
  )
  AND sr.settled_at > NOW() - INTERVAL '30 days';
```

**Threshold reached when `clv_settled_count >= 10`.**

Secondary check — confirm trust function will fire:

```sql
SELECT 
  p.metadata->>'capper' as capper_tag,
  p.source,
  p.capper_id,
  sr.payload->>'clvPercent' as clv_percent,
  sr.settled_at
FROM picks p
JOIN settlement_records sr ON sr.pick_id = p.id
WHERE sr.source = 'grading'
  AND sr.payload->>'clvPercent' IS NOT NULL
  AND (p.metadata->>'capper' = 'griff843' OR p.source = 'griff843')
ORDER BY sr.settled_at DESC
LIMIT 20;
```

---

## 6. Trigger: What Changes at Threshold

When `clv_settled_count >= 10` for griff843:

1. `computeClvTrustAdjustment('griff843', ...)` returns a non-null
   `ClvTrustAdjustment` instead of `null`.

2. Promotion scoring (`evaluateAndPersistPromotion`) receives an adjusted
   trust input:
   - If griff843's avg CLV > +2%: trust +5 points
   - If avg CLV > +1%: trust +3 points
   - If avg CLV −1% to +1%: trust 0 (neutral)
   - If avg CLV < −1%: trust −3 points
   - If avg CLV < −2%: trust −5 points

3. Picks from griff843 can be promoted or blocked based on historical CLV
   signal rather than running with unadjusted trust.

4. `market_family_trust` (the candidate-scoring trust table) is populated
   by the CLV weight tuner once sufficient settlement data exists across
   market families (separate process, `MIN_TRUST_SAMPLE_SIZE = 5`).

---

## 7. Action Items (for subsequent lanes)

| Priority | Action | Lane Scope |
|----------|--------|-----------|
| P1 | Fix smart-form to set `metadata.capper` on submissions | Separate code lane |
| P2 | Increase griff843 pick submission rate to ≥3/day | Operational (manual) |
| P3 | Verify ingestor CLV coverage for MLB markets (post-UTV2-1315) | Monitoring |
| P4 | Once 10 CLV settlements exist, run CLV weight tuner to populate `market_family_trust` | Separate proof lane |

---

## 8. Dependencies

- UTV2-1315: ingestor clean cycle (confirmed DONE/GREEN) — CLV odds ingestion is operational
- UTV2-1327: model-driven promotion (Phase 1 of winning-picks plan) — promotion path active
- Smart-form capper tagging fix (unscheduled) — prerequisite for P1 above
