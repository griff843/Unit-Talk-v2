---
name: utv2-1262-verification
description: Verification log for UTV2-1262 — closing odds capture wired at settlement
metadata:
  type: runtime
  issue: UTV2-1262
  tier: T1
  branch_sha: b16ee41f546076608167e97674bab9a181a0a44a
---

## Verification — UTV2-1262

**Issue:** Restore closing odds capture for true CLV-path evidence  
**Tier:** T1  
**Branch SHA:** `b16ee41f546076608167e97674bab9a181a0a44a`

### pnpm verify — PASS

```
# tests 113
# suites 13
# pass 113
# fail 0
# cancelled 0
# skipped 0
# duration_ms ~748
```

All checks: env:check + lint + type-check + build + test green.

### R-level check — PASS

```
Verdict: PASS
Changed files: 10
Rules matched: settlement-grading
Advisory (PM-gated) artifacts missing:
  - r4-fault-report [PM-gated]
```

r4-fault-report is PM-gated advisory only — not blocking.

### pnpm test:db — PASS (live Supabase)

```
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# duration_ms 144424
```

Supabase project: `zfzdnfwdarxucxtaojxm`

Tests include:
- T1 Proof 1 — attempted UPDATE on settlement_records rejected
- T1 Proof 2 — single-approver correction rejected by DB constraint
- T1 Proof 3 — dual-authorized correction creates settlement_corrections record
- T1 Proof 4 — PnL reproduces through correction chain
- atomic delivery confirmation rollback test (3 assertions)
- no duplicate participants for same external_id and sport
- re-settling creates correction, no duplicate base rows

### Settlement isolation test — PASS

Fail-open pattern verified: `writeClosingClvSnapshot` failure never propagates to settlement caller. Test: "fail-open: closing_for_clv snapshot repo throws — settlement still succeeds".

### Proof script output (before state)

```
closing_for_clv total rows:              5
total settled records (all):             8499
closing_for_clv with settlement_record_id: 5
(All 5 are legacy fixtures from 2026-04-30)
snapshot_kind distribution: { submission: 6, posting: 5, closing_for_clv: 5, settlement_proof: 5 }
```

**Expected after-state:** New `closing_for_clv` rows accumulate as settlements complete with CLV computed. Re-run proof script post-deploy after grading sweep to observe count > 5.

### Dry-run backfill report

```
Total settled records sampled:   500
Already have closing_for_clv:    5
Eligible candidates (no snapshot): 495
CLV data in payload (resolvable): 173
No CLV data in payload:           322
Would-insert count (dry-run):     173
Duplicate/conflict count:         0
```

Live backfill NOT authorized. Requires separate PM approval after forward-flow observation.
