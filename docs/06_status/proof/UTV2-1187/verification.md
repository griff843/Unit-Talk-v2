# UTV2-1187 Verification Log

Date: 2026-05-29
Branch: codex/utv2-1187-cr-9-fix-or-recategorize-t1-proof-scoring-integrity-data

## Verification

### npx tsx --test apps/api/src/t1-proof-scoring-integrity.test.ts

PASS (2 tests, 0 failures)
- UTV2-1187: recategorized scoring integrity audit — C1/C3/C4/C5 (live DB)
- UTV2-1187: proof is deterministic

Live audit results:
- C1 confidence-proxy rate: 82.25% — AUDIT_ONLY_THRESHOLD_MISS
- C3 uniqueness: 7 distinct values, fallback 0.3% — PASS
- C4 band missing: 0/26 promoted rows — PASS
- C5 missing target: PPH:0/26 + picks:20/55 — AUDIT_ONLY_THRESHOLD_MISS
- Determinism: 500 rows both queries — PASS

### pnpm type-check

PASS

### pnpm test

PASS (transient live-DB fetch retry resolved on rerun)

### pnpm verify

PASS

### npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD

PASS — Verdict: PASS. No R-level artifacts required.

## Notes

Test recategorized from T1 acceptance gate to T2 audit. Threshold misses reflect live data quality issues outside this lane's file scope.
