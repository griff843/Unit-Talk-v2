# UTV2-1267 Verification

## Summary

Sample-seeded DB-signal classification of the 172 backfilled `closing_for_clv` rows,
with per-row `validation_source` and `provider_truth_verified` flags.

**This is NOT full provider-truth verification of all 172 rows.**
Precise framing: **172 rows classified by DB-signal + 13-row MCP direct validation overrides**
(from the 31-row sampled SGO MCP review, only the 13 non-PASS verdicts were durably
recorded per pick_id; sampled rows that passed were not durably recorded and are
conservatively classified `db_signal_only`).

Output: `docs/06_status/proof/UTV2-1267/audit-results.json`

Posture: `DATA_SUFFICIENT_READY_FOR_FILTERED_PM_REVIEW` (unchanged — not certification)

## Evidence

### Classification Results (172 rows)

| Verdict | Count | % |
|--------|-------|---|
| PASS | 159 | 92.4% |
| WARN | 7 | 4.1% |
| FAIL | 6 | 3.5% |

PASS rate excluding FAIL: 95.8% — **this is a DB-signal pass rate, not a
provider-truth pass rate.** All 159 PASS rows are `db_signal_pass_unverified`.

### validation_source (per row)

| validation_source | Count | provider_truth_verified |
|-------------------|-------|-------------------------|
| mcp_direct | 13 | true |
| poh_verified | 0 | — |
| db_signal_only | 159 | false |

### Split metrics

| Metric | Count |
|--------|-------|
| mcp_direct_pass | 0 |
| poh_verified_pass | 0 |
| db_signal_pass_unverified | 159 |
| warn | 7 |
| fail_excluded | 6 |

**provider_truth_pass = 0.** Every row with a durable provider-truth verdict
(mcp_direct) was FAIL or WARN. No PASS row in this dataset is provider-truth
verified. UTV2-1042 reports must never count `db_signal_only` rows as
provider-truth verified — they are advisory only.

### Why poh_verified = 0

Backfilled snapshot payloads carry no provider identifiers
(`provider_event_id` / `provider_market_key` / `provider_participant_id` are
absent — payload keys are clv_raw, clv_percent, entry_odds, backfill,
backfill_lane, backfill_source, beats_closing_line, original_clv_computed_at;
verified live 2026-06-12). Because the UTV2-1262 backfill derived its closing
values from the same local provider data, a `provider_offer_history` re-match
would be circular self-confirmation, not independent provider-truth
verification. Independent verification for these rows requires SGO MCP
(historical closeBookOdds), tracked as a future T1 lane.

### FAIL Root Causes (all mcp_direct, provider-truth confirmed)

| Code | Count | Description |
|------|-------|-------------|
| LINE_MOVE_STALE | 3 | DB has stale pre-move odds; SGO true close was on different line |
| 1H_NO_CLOSE | 2 | 1H market — SGO provides no Pinnacle closing odds |
| ALT_LINE | 1 | Alt-line contamination (includeAltLines bug, fixed in UTV2-1266) |

### WARN Root Causes

| Code | Count | validation_source |
|------|-------|-------------------|
| ODDS_TIMING_DRIFT | 2 | mcp_direct |
| LINE_MOVED_CORRECT_CLOSE_DRIFT | 2 | mcp_direct |
| INTERMEDIATE_SNAPSHOT | 1 | mcp_direct |
| NO_CLOSE_ONE_SIDE | 1 | mcp_direct |
| SETTLEMENT_SOURCE_MISMATCH | 1 | mcp_direct |

### Per-row fields (all 172 rows)

Every row in `audit-results.json` includes: `pick_id`, `verdict`, `reason_code`,
`validation_source`, `provider_truth_verified`, `backfill_source`
(`UTV2-1262-historical`), `backfill_lane` (`UTV2-1262`). Validated mechanically —
no row missing any required field.

### Audit Script

```bash
tsx apps/api/src/scripts/sgo-provider-truth-audit.ts
# output: docs/06_status/proof/UTV2-1267/audit-results.json
```

Script is read-only — no production data mutated.

## Verification

**Branch HEAD SHA:** `48996aa1b2072af7af6cd5a8102f6108bda55783`
**Merge SHA:** `fc09529861b78223de5a61077d1537d938655909` (PR #1019, merged 2026-06-12, CI green on merge SHA)

### Static verification (pnpm verify)

```
pnpm type-check   # pass — 0 errors
pnpm test         # pass — 113/113
pnpm verify       # pass — all checks green on merge SHA fc09529861b78223de5a61077d1537d938655909
```

CI run on merge SHA: https://github.com/griff843/Unit-Talk-v2/actions/runs/27440894747 — success

### R-level check

```
tsx scripts/ci/r-level-check.ts --base fc09529861b78223de5a61077d1537d938655909^ --head fc09529861b78223de5a61077d1537d938655909
Verdict: PASS
Changed files: 6
Rules matched: (none) — no R-level artifacts required for this diff
```

### Script Run (corrected semantics)

```
[UTV2-1267] Starting provider-truth audit...
[UTV2-1267] Fetched 172 backfilled closing_for_clv rows

[UTV2-1267] Classification complete:
  Total rows : 172
  PASS       : 159 (92.4%)
  WARN       : 7 (4.1%)
  FAIL       : 6 (3.5%)
  PASS rate (excl. FAIL): 95.8%

  validation_source: {"mcp_direct":13,"poh_verified":0,"db_signal_only":159}
  split_metrics    : {"mcp_direct_pass":0,"poh_verified_pass":0,"db_signal_pass_unverified":159,"warn":7,"fail_excluded":6}

  FAIL reasons: {"ALT_LINE":1,"LINE_MOVE_STALE":3,"1H_NO_CLOSE":2}
  WARN reasons: {"ODDS_TIMING_DRIFT":2,"NO_CLOSE_ONE_SIDE":1,"LINE_MOVED_CORRECT_CLOSE_DRIFT":2,"INTERMEDIATE_SNAPSHOT":1,"SETTLEMENT_SOURCE_MISMATCH":1}

  Posture: DATA_SUFFICIENT_READY_FOR_FILTERED_PM_REVIEW

[UTV2-1267] Audit complete.
```

### pnpm test:db

```
pnpm test:db
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 120578
```

7/7 DB integration tests pass against live Supabase (zfzdnfwdarxucxtaojxm).

### Guardrails

- No production data mutated (read-only script)
- FAIL rows excluded from all certification-facing evidence metrics
- db_signal_only rows never reported as provider-truth verified
- Backfill provenance visible in all output (backfill_source + backfill_lane per row)
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
| all DB signals healthy (no provider-truth check) | PASS: DB_SIGNAL_PASS (unverified) |
