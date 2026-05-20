# UTV2-1036 — Diff Summary

**Issue:** UTV2-1036 — Scoring integrity acceptance gate
**Lane type:** T1 verification
**Branch:** `claude/utv2-1036-scoring-integrity-acceptance-gate`
**Branch HEAD SHA:** `e452ddb9114c7948b67e74f5bd0bfa17862ecbd0`

---

## What was done

This lane adds a scoring integrity acceptance gate that measures 5 criteria against live Supabase data. No production code was changed — this is a pure verification/proof lane.

### New files added

1. **`scripts/scoring-integrity-proof.ts`**
   - Connects to live Supabase using `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
   - Queries `pick_promotion_history` and `picks` for the last 30 days
   - Measures all 5 acceptance criteria
   - Outputs structured JSON (`--json` flag) or human-readable text
   - Exits non-zero if any criterion fails

2. **`apps/api/src/t1-proof-scoring-integrity.test.ts`**
   - T1 live-DB proof test (node:test + assert)
   - Two tests: (1) scoring integrity metrics meet pass gates; (2) proof is deterministic
   - Gated on `SUPABASE_SERVICE_ROLE_KEY`

3. **`docs/06_status/proof/UTV2-1036/verification.md`** — Full proof output and analysis
4. **`docs/06_status/proof/UTV2-1036/diff-summary.md`** — This file
5. **`docs/06_status/proof/UTV2-1036/evidence-bundle.json`** — SHA-bound evidence bundle (schema_version: 1)

### package.json change

`test:t1-proof` script updated to include `t1-proof-scoring-integrity.test.ts`.

---

## Why

UTV2-1036 requires a live-DB proof that post-fix promotion inputs are real, populated, and non-fallback. This lane establishes the measurement infrastructure and documents the observed state of each criterion.

---

## Findings

| Criterion | Result | Note |
|-----------|--------|------|
| C1: confidence-proxy rate | **PASS** — 4.87% | Below 10% threshold |
| C2: readiness fallback rate | **FAIL** — 94.21% | kelly gradient data absent from picks metadata |
| C3: uniqueness distribution | **PASS** — 7 values, 0% fallback | Real open-picks data driving scores |
| C4: band coverage | **PASS** — 0 missing | All promoted picks have resolvable band |
| C5: qualified target coverage | **PASS** — 0 missing | All qualified picks have routing target |

C2 failure is documented honestly. The root cause is that upstream submitters (board-construction, system-pick-scanner) do not write `metadata.kellySizing.fractional_kelly` to picks, causing `kellyGradientReadiness` to fall back to the default value (60) for 94.21% of picks. This is a data gap in the ingestion pipeline, not a defect in the promotion engine itself.
