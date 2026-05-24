# UTV2-1034 Diff Summary

**Issue:** Run model calibration baseline — Brier score, ECE, log-loss against post-fix settlements  
**Tier:** T2  
**Branch:** claude/utv2-1034-model-calibration-baseline  

## Changes

### `scripts/calibration-report.ts` (new)
Analytics script that:
- Queries `settlement_records` joined with `picks` for picks settled after a given date (default: 2026-05-11)
- Computes Brier score, ECE (10-bucket reliability diagram), and log-loss
- Segments results by sport, model version (promotion_version), and confidence band (<50%, 50-64%, 65-79%, 80%+)
- Writes output to `docs/06_status/proof/calibration-baseline-YYYYMMDD.md`
- Exits with warning if insufficient sample size (<20 usable rows)
- Reports ECE > 0.10 trigger for follow-on recalibration issue

### `docs/06_status/proof/calibration-baseline-20260524.md` (new)
Baseline run output: 2 rows queried from live DB, both with null confidence values.
Data gate confirmed: insufficient settlement data available (ingestor was stalled).
Script infrastructure is ready — will auto-generate results once 20+ confidence-bearing settled picks accumulate.

## Live Run Result

Script ran against live Supabase (zfzdnfwdarxucxtaojxm):
- Total rows queried: 2 (settled after 2026-05-11)
- Usable rows: 0 (both had null confidence)
- Decision: Insufficient data — 20+ picks required for meaningful calibration

## Verification
- `pnpm verify`: 113/113 PASS ✅
- R-level check: PASS (no artifacts required for scripts/ changes)
