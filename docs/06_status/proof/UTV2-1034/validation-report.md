# UTV2-1034 Validation Report

**Issue:** Model calibration baseline — Brier score, ECE, log-loss  
**Tier:** T2  
**Branch:** claude/utv2-1034-model-calibration-baseline  
**Date:** 2026-05-24  

## Script Validation

### `scripts/calibration-report.ts`

| Check | Result |
|-------|--------|
| TypeScript compiles (tsx execution) | PASS |
| Supabase query executes without error | PASS |
| Data gate triggers correctly at n<20 | PASS |
| ECE threshold check (>0.10) logic present | PASS |
| Output written to correct path | PASS |
| Segments by sport, model version, confidence band | PASS |

### Math Validation

| Function | Property | Verified |
|----------|----------|---------|
| `brierScore` | Returns NaN on empty input | ✅ |
| `brierScore` | Clips probabilities to [ε, 1-ε] | ✅ |
| `logLoss` | Proper scoring rule, clipped | ✅ |
| `eceWithBuckets` | 10 equal-width buckets [0,10), [10,20), ..., [90,100] | ✅ |
| `eceWithBuckets` | Returns NaN ece on empty input | ✅ |

### Live DB Run

- **DB:** Supabase `zfzdnfwdarxucxtaojxm`  
- **After date:** 2026-05-11 (post-fix settlements from UTV2-901/903/906/879)  
- **Total rows:** 2  
- **Usable rows:** 0 (both had null confidence in `picks.confidence`)  
- **Decision:** Insufficient data — data gate correctly held (min 20 required)  
- **Follow-on:** Not triggered (0 usable rows < 20 threshold; ECE is n/a)

## Data Gate Confirmation

The script correctly defers tier-label decisions when sample size < 20. Script infrastructure is production-ready; calibration metrics will be generated automatically once sufficient confidence-bearing settled picks accumulate post-ingestor recovery (tracked in UTV2-1032).
