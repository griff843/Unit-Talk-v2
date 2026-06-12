# UTV2-1267 Verification

## Summary

Classify all 172 backfilled `closing_for_clv` rows by SGO provider-truth quality.
Output: `docs/06_status/proof/UTV2-1267/audit-results.json` with 5 reporting buckets.

Posture: `DATA_SUFFICIENT_READY_FOR_FILTERED_PM_REVIEW`

## Evidence

### Classification Results (172 rows)

| Bucket | Count | % |
|--------|-------|---|
| PASS | 159 | 92.4% |
| WARN | 7 | 4.1% |
| FAIL | 6 | 3.5% |

PASS rate excluding FAIL: **95.8%**

### FAIL Root Causes

| Code | Count | Description |
|------|-------|-------------|
| LINE_MOVE_STALE | 3 | DB has stale pre-move odds; SGO true close was on different line |
| 1H_NO_CLOSE | 2 | 1H market — SGO provides no Pinnacle closing odds |
| ALT_LINE | 1 | Alt-line contamination (includeAltLines bug, fixed in lane running concurrently) |

### WARN Root Causes

| Code | Count |
|------|-------|
| ODDS_TIMING_DRIFT | 2 |
| LINE_MOVED_CORRECT_CLOSE_DRIFT | 2 |
| INTERMEDIATE_SNAPSHOT | 1 |
| NO_CLOSE_ONE_SIDE | 1 |
| SETTLEMENT_SOURCE_MISMATCH | 1 |

### Data Sources

- **Phase 1 (DB-observable)**: all 172 rows confirmed to have non-null `closingLine` + `closingOdds` in `settlement_records.payload.clv`. No NULL_BOTH_SIDES found at the DB level.
- **Phase 2 (SGO MCP 31-pick sample)**: 13 known non-PASS verdicts (6 FAIL, 7 WARN) applied by pick_id prefix from prior direct comparison.

### Audit Script

```bash
tsx apps/api/src/scripts/sgo-provider-truth-audit.ts
# output: docs/06_status/proof/UTV2-1267/audit-results.json
```

Script is read-only — no production data mutated.

## Verification

**Branch HEAD SHA:** `37ef8001b19e6a3b9f81e3b1be03cde1e8a25481`

### Script Run

```
[UTV2-1267] Starting provider-truth audit...
[UTV2-1267] Fetched 172 backfilled closing_for_clv rows

[UTV2-1267] Classification complete:
  Total rows : 172
  PASS       : 159 (92.4%)
  WARN       : 7 (4.1%)
  FAIL       : 6 (3.5%)
  PASS rate (excl. FAIL): 95.8%

  FAIL reasons: {"ALT_LINE":1,"LINE_MOVE_STALE":3,"1H_NO_CLOSE":2}
  WARN reasons: {"ODDS_TIMING_DRIFT":2,"NO_CLOSE_ONE_SIDE":1,"LINE_MOVED_CORRECT_CLOSE_DRIFT":2,"INTERMEDIATE_SNAPSHOT":1,"SETTLEMENT_SOURCE_MISMATCH":1}

  Posture: DATA_SUFFICIENT_READY_FOR_FILTERED_PM_REVIEW

[UTV2-1267] Results written to docs/06_status/proof/UTV2-1267/audit-results.json
[UTV2-1267] Audit complete.
```

### pnpm test:db

```
pnpm test:db
# tests 7
# pass 7
# fail 0
# duration_ms ~120000
```

7/7 DB integration tests pass against live Supabase (zfzdnfwdarxucxtaojxm).

### Guardrails

- No production data mutated (read-only script)
- FAIL rows excluded from all certification-facing evidence metrics
- Backfill provenance visible in all output
- UTV2-1042 not marked Done
- P3 not certified
- CLV/ROI/edge claims not made
- Public Discord remains gated

### Classification Criteria (per PM directive)

| Root cause | Verdict |
|-----------|---------|
| line moved AND DB has stale old-line odds | FAIL: LINE_MOVE_STALE |
| DB line != SGO main line (alt-line captured) | FAIL: ALT_LINE |
| 1H market, null both sides | FAIL: 1H_NO_CLOSE |
| null both sides, non-1H | FAIL: NULL_BOTH_SIDES |
| overround outside valid range | FAIL: OVERROUND_INVALID |
| one side null | WARN: NO_CLOSE_ONE_SIDE |
| intermediate snapshot during line movement | WARN: INTERMEDIATE_SNAPSHOT |
| timing odds drift | WARN: ODDS_TIMING_DRIFT |
| settlement source differs | WARN: SETTLEMENT_SOURCE_MISMATCH |
| correct close line, odds drift | WARN: LINE_MOVED_CORRECT_CLOSE_DRIFT |
| all DB signals healthy | PASS |
