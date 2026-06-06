# UTV2-1213 Verification

## Verification

**Issue:** UTV2-1213 — Wave 5 opportunity wiring / snap_share provenance gate  
**Branch:** `claude/utv2-1213-opportunity-provenance-gate`  
**Branch HEAD:** `8a16511ba135744b9d96d19fc484cbb4f8278063`  
**Verified by:** claude  
**Date:** 2026-06-06

### pnpm verify

```
pnpm verify — exit 0
env:check PASS
lint PASS
type-check PASS
build PASS
test PASS (18/18 stat-distribution tests, all suites)
automation-coverage-check PASS
```

### pnpm test:db

```
7/7 live Supabase smoke tests PASS
Supabase project: zfzdnfwdarxucxtaojxm
duration_ms: 103195
```

### Provenance gate tests (new — UTV2-1213)

```
snap_share provenance gate — UTV2-1213
  ✓ snap_share usage_rate_source → ok:false (fail-closed)
  ✓ snap_share_suppressed:true → ok:false (explicit suppression flag)
  ✓ direct usage_rate_source → ok:true and usage_rate_source in output
```

### R-level check

```
Verdict: PASS
Changed files: 2
Rules matched: (none) — no R-level artifacts required for this diff
```

### Constitutional constraints

- P3 remains ACTIVE_NOT_CERTIFIED — no cert advance
- P5 remains FROZEN_NOT_CERTIFIED
- SGO not activated
- No market inputs introduced
- All computation deterministic and replayable
