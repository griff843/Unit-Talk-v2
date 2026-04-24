# PROOF: UTV2-589
MERGE_SHA: 4df5779

ASSERTIONS:
- [x] Settlement records populated with result, confidence, and settler identity — PASS (91 records, grading-service)
- [x] Correction chain preserves immutable original — PASS (1 correction: Panarin loss→win, original row intact)
- [ ] CLV reconciles to actual closing-line data — BLOCKED (DEBT-003: no board-construction picks in settlement)
- [ ] P&L/ROI reconciles to settlement and stake truth — BLOCKED (stake_units NULL on smart-form picks)

EVIDENCE:
```text
=== UTV2-589: Settlement / CLV / P&L Validation — 2026-04-24T05:10Z ===
Run SHA: 4df5779  |  Supabase: zfzdnfwdarxucxtaojxm

SETTLEMENT INTEGRITY
  Total records:       91
  Active (no correction): 90
  Correction records:  1
  All with result:     YES
  All confidence:      confirmed
  Settler:             grading-service
  Date range:          2026-04-21 → 2026-04-24
  Source breakdown:    smart-form=87, canary-proof=2, api=1, board-construction=0

SAMPLE (5 records — result × confidence × odds × market all verified):
  player_rebounds_ou  over  +122  WIN   confirmed
  player_points_ou    over  -110  WIN   confirmed
  player_assists_ou   over  -147  LOSS  confirmed
  player_rebounds_ou  over  -135  LOSS  confirmed
  player_assists_ou   over  -113  WIN   confirmed

CORRECTION CHAIN
  Original:   e92437d7  loss  2026-04-22T19:37:33Z
  Correction: 0996bc0d  win   2026-04-22T19:37:42Z  (+9s)
  Notes:      "actual Panarin powerPlay_goals+assists = 1 > 0.5 line — OVER wins"
  Invariant:  corrects_id FK intact; original row unmodified ✓

CLV COVERAGE
  Settled picks with pick_candidates: 0/90
  Root cause: scanner quiesced (DEBT-003) → 0 board-construction picks in settlement
  Market universe closing line: 76.3% of 18,869 rows populated (data ready)
  CLV verdict: BLOCKED

P&L / ROI
  stake_units populated: 0/90
  Root cause: smart-form/canary picks carry no stake_units
  P&L verdict: BLOCKED
```

ROOT CAUSE (both CLV and P&L):
system-pick-scanner quiesced (DEBT-003). All settled picks are smart-form/canary-proof.
Board-construction picks — the only picks with pick_candidates + stake_units — have not
entered settlement because the scanner hasn't produced any. Once re-enabled, CLV + P&L
proof completes with no code changes; closing line data is 76.3% populated and ready.

REMAINING BLOCKER:
PM decision to re-enable system-pick-scanner (DEBT-003).
All preconditions met:
  - DEBT-002 resolved (UTV2-539 Done 2026-04-12)
  - Brake proven (UTV2-494 Done 2026-04-11)
