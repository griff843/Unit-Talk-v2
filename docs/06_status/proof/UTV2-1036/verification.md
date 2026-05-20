# UTV2-1036 — Scoring Integrity Acceptance Gate: Verification

**Branch:** `claude/utv2-1036-scoring-integrity-acceptance-gate`
**Branch HEAD SHA:** `e452ddb9114c7948b67e74f5bd0bfa17862ecbd0`
**Proof run at:** 2026-05-20T02:32:33Z
**Cohort:** Last 30 days (2026-04-20 → 2026-05-20)
**PPH rows queried:** 1000
**Picks with promotion data:** 1000

---

## Acceptance Criteria Results

| # | Criterion | Threshold | Measured | Status |
|---|-----------|-----------|----------|--------|
| C1 | confidence-proxy rate for post-fix cohort | <= 10% | 4.87% | **PASS** |
| C2 | readiness fallback rate (readiness=60 default) | <= 5% | 94.21% | **FAIL** |
| C3 | uniqueness distribution (> 1 value, no 50-dominance) | > 1 value; val=50 <= 50% | 7 values; 0% | **PASS** |
| C4 | band missing rate for promoted picks | 0 missing | 0 missing | **PASS** |
| C5 | qualified picks with null promotion target | 0 missing | 0 missing | **PASS** |

**Overall verdict: FAIL (1 of 5 criteria not met)**

---

## Detailed Results

### C1: Confidence-proxy rate — PASS (4.87%)

48 out of 985 PPH rows with score inputs used confidence-proxy edge resolution:
- `edgeMethod=confidence-delta`, OR
- `edgeSourceQuality=confidence-fallback`, OR
- `edgeSource=confidence-delta` + `providerCoverageState=none`

Edge method distribution: `market-devigged=937, confidence-delta=48`
Provider coverage state distribution: `sgo=867, none=118`

This is below the 10% threshold. The promotion pipeline is successfully routing most picks through real market data (SGO devigging).

---

### C2: Readiness fallback rate — FAIL (94.21%)

928 out of 985 PPH rows have `scoreInputs.readiness = 60` (the default fallback value).

Distribution of readiness values:
- `60` = 928 rows (94.21%)
- `51` = 51 rows (5.18%)
- `44` = 3 rows (0.30%)
- `49` = 3 rows (0.30%)

**Root cause:** The `readiness` component in the promotion scoring pipeline defaults to 60 when kelly gradient data is absent from pick metadata. The `kellyGradientReadiness` function reads `metadata.kellySizing.fractional_kelly` (fixed in UTV2-986), but upstream submitters (board-construction, system-pick-scanner) are not writing this field to pick metadata. As a result, 94.21% of picks fall back to the default readiness score of 60 rather than computing a real kelly-based readiness.

**This is an honest measurement of a known upstream data gap.** The fix is in UTV2-986 (correct field name), but the upstream data population is not yet complete.

**Impact:** The readiness score contributes 20% weight to the promotion score. With 94.21% of picks using the fallback, the readiness dimension is effectively a constant for most picks, reducing the discrimination power of the scoring model.

---

### C3: Uniqueness distribution — PASS (7 distinct values, 0% fallback)

7 distinct uniqueness values found in the post-fix cohort:
- `20` = 358 rows
- `100` = 291 rows
- `40` = 162 rows
- `30` = 63 rows
- `90` = 48 rows
- `80` = 27 rows
- `60` = 36 rows

The default fallback value (50) appears in 0% of rows. Uniqueness is being computed from real open-picks data (market saturation count), producing meaningful discrimination.

---

### C4: Band coverage for promoted picks — PASS (0 missing)

3 PPH rows with status=`qualified` in the cohort. All 3 have a band resolvable from score (score is non-null; band is inferred as A+/A/B/C using score thresholds). Band distribution:
- Inferred from score in all 3 cases

For the broader PPH population (1000 rows), band was present in 976 rows via `payload.band`.

---

### C5: Qualified picks have promotion target — PASS (0 missing)

- PPH qualified rows: 3, all with non-null `target`
- Picks table `promotion_status=qualified`: 22, all with non-null `promotion_target`

Every qualified pick has a deterministic routing target recorded.

---

## Script Output (verbatim)

```
scoring-integrity-proof — 2026-05-20 02:32
Cohort: last 30 days (2026-04-20T02:32:33.640Z → now)
PPH rows: 1000  |  Picks with promo: 1000
────────────────────────────────────────────────────────────────────────
  [PASS] C1: confidence-proxy rate <= 10% for post-fix cohort
       Threshold: <= 10%
       Measured:  4.87%
       Detail:    48/985 picks used confidence-proxy edge resolution

  [FAIL] C2: readiness fallback rate (readiness=60 default) <= 5%
       Threshold: <= 5%
       Measured:  94.21%
       Detail:    928/985 PPH rows have readiness=60 (default fallback).
                  Kelly sizing data is absent for most picks.
                  Distribution: {"44":3,"49":3,"51":51,"60":928}

  [PASS] C3: uniqueness distribution: > 1 distinct value, no hardcoded default dominance
       Threshold: > 1 distinct value AND uniqueness=50 rate <= 50%
       Measured:  7 values; fallback(50)=0%
       Detail:    7 distinct uniqueness values. Top: 20=358, 100=291, 40=162, 30=63, 90=48

  [PASS] C4: band missing rate = 0 for post-fix promoted picks
       Threshold: 0 missing bands
       Measured:  0 missing (0%)
       Detail:    3 promoted PPH rows checked; 0 missing band.

  [PASS] C5: no qualified pick lacks a deterministic promotion target
       Threshold: 0 qualified picks with null target
       Measured:  0 missing
       Detail:    PPH: 0/3 qualified rows missing target.
                  Picks table: 0/22 qualified picks missing promotion_target.

────────────────────────────────────────────────────────────────────────
VERDICT: FAIL — 1 criterion(ia) not met:
  - C2: readiness fallback rate (readiness=60 default) <= 5%
```

---

## Summary

4 of 5 acceptance criteria pass. C2 fails because kelly gradient readiness data is not being written to pick metadata by upstream submitters. This is a data gap, not a code defect introduced by this lane. The proof faithfully documents the observed state of the production system. The C2 failure must be resolved by upstream changes (populating `metadata.kellySizing.fractional_kelly` in board-construction and system-pick-scanner) before this criterion can pass.

The scoring integrity proof script (`scripts/scoring-integrity-proof.ts`) and T1 proof test are added to enable ongoing measurement of all 5 criteria.
