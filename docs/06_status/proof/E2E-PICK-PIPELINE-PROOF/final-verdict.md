# E2E Pick Pipeline Proof Loop — Final Verdict

**Controlling issue:** UTV2-1359 / UTV2-1363  
**Date:** 2026-06-29  
**Analyst:** Claude Code (claude-sonnet-4-6)  
**Reclassified:** 2026-06-29 (PM ruling — reconcile timestamps before claiming PASS)

---

## VERDICT: PASS_MECHANICS_ONLY

The system lifecycle mechanics are proven. True forward-flow is NOT yet proven.

**Proof pick:** `a122bcca-602a-4e2f-8b0e-1853278e9043`  
**Source:** `system-pick-scanner`  
**Market:** `player_batting_total_bases_ou`  
**Selection:** `under`  
**Odds:** -141  
**Sport:** MLB  
**Event:** LAD vs. SD Padres — `28d77119-34b6-46dc-b534-72302ad9ac5c` (external_id: `SMhRbpDvSvFnTs74EU1y`)  
**Settlement:** `dba9306b-884f-4aa0-b72d-edf46d01d02d`

---

## Timing Reconciliation (PM-Ordered)

| Milestone | Time (ET) | Notes |
|-----------|-----------|-------|
| Event created in DB | Jun 25, 8:37 AM | Scheduled for Jun 26/27 game |
| **Game start** | **Jun 27, 8:40 PM** | eventTime = 2026-06-28T00:40:00Z |
| Odds snapshot (stale) | Jun 27, 11:00 PM | snapshot_at = 2026-06-28T03:00:16Z — post-game |
| game_results sourced | **Jun 28, 12:09 AM** | sourced_at — game complete |
| game_results created | **Jun 28, 12:12 AM** | created_at — result in DB 31h before pick |
| Event marked completed | Jun 28, 12:09 AM | events.updated_at |
| **Pick a122bcca created** | **Jun 29, 7:10 AM** | 34.5h after game start; 31h after result |
| Governance brake | Jun 29, 7:10 AM | validated → awaiting_approval |
| Manual operator approval | Jun 29, 10:23 AM | UTV2-1363 PM gate, operator_override RPC |
| Manual posted | Jun 29, 10:23:15 AM | 7s after queued — orchestrator RPC call |
| Manual settled | Jun 29, 10:23:22 AM | 14s total — orchestrator RPC call, NOT grading cron |

### Critical Disqualifiers for PASS_FORWARD_FLOW

| Flag | Value | Implication |
|------|-------|-------------|
| data_freshness | `"stale"` (explicit in metadata) | Candidate not from current ingestion |
| snapshot_age_ms | 115,801,113 (~32.2 hours) | Odds snapshot from post-game, day-old data |
| hasPositiveEdge | false | Negative EV (-0.87%) |
| realEdge | -0.008711 | No edge |
| raw_kelly | -0.346766 | Negative Kelly — no bet |
| recommended_units | 0 | Kelly=0 |
| modelTier / band | SUPPRESS / SUPPRESS | Scanner suppressed this pick |
| Game result pre-existed | 31 hours before pick creation | Not predictive; retroactive |
| Settlement method | Manual RPC (3 calls in 14s) | Not the automated grading/settlement cron |
| CLV source | market_universe_provenance | From pre-existing closed-game data |

---

## game_results Row

| Field | Value |
|-------|-------|
| id | `493c640d-aa2d-40f6-86d5-7678a5df3f83` |
| event_id | `28d77119-34b6-46dc-b534-72302ad9ac5c` |
| participant_id | `ee7485eb-f990-441f-bcfa-da3fda38dd1e` |
| market_key | `player_batting_total_bases_ou` |
| actual_value | `1` |
| source | `sgo` |
| sourced_at (ET) | 2026-06-28 00:09:34 |
| created_at (ET) | 2026-06-28 00:12:19 |

The game_result row was in the database **31 hours before the pick was created**.

---

## What PASS_MECHANICS_ONLY Proves

- Governance brake fires on autonomous sources and enforces awaiting_approval ✅
- Lifecycle FSM (`pick_lifecycle` table, `transition_pick_lifecycle` RPC) enforces valid state sequence ✅
- Settlement record created with CLV, ROI, evidencePlane flag ✅
- CLV computed correctly from market_universe_provenance (rank=1 verified source) ✅
- Audit trail (pick_lifecycle + audit_log) is complete and queryable ✅
- No public delivery constraint was honored (discord:canary internal only) ✅
- PM gate mechanism (operator_override writer_role) works ✅

## What Is NOT Proven

- A current, fresh pregame pick with positive EV can be generated from live provider data
- The candidate pipeline rejects stale, suppressed, negative-EV candidates before pick creation
- The automated grading cron (not manual RPC) correctly settles a forward-flow pick post-game
- CLV/ROI reflects true predictive value vs. a known result

---

## Required for PASS_FORWARD_FLOW

1. Candidate quality gates (UTV2-1364) implemented and blocking:
   - Reject `data_freshness = "stale"` candidates
   - Reject `snapshot_age_ms > freshness_threshold` (e.g., 3600000 ms = 1 hour)
   - Reject `kelly.recommended_units = 0` (Kelly=0 / negative EV)
   - Reject `modelTier = "SUPPRESS"` or `band = "SUPPRESS"`
   - Reject extreme juice (configurable threshold, e.g., |odds| > 300)
   - Reject outside posting window
   - Require player/participant enrichment
   - Enforce market allowlist by sport

2. A fresh pick created from current provider data before game start, with:
   - positive EV (hasPositiveEdge = true)
   - non-zero Kelly (recommended_units > 0)
   - snapshot_age within freshness window at pick creation
   - game_results row NOT present at pick creation time

3. Automated grading cron processes the pick post-game (not manual RPC).

4. CLV computed from truly closing line data (not pre-existing stale snapshot).

---

## Lifecycle Trace (Manual Proof Mechanics)

| from_state | to_state | writer_role | reason | timestamp (ET) |
|------------|----------|-------------|--------|----------------|
| null | validated | submitter | validated submission materialized | 2026-06-29 07:10:18 |
| validated | awaiting_approval | promoter | governance brake: non-human source | 2026-06-29 07:10:24 |
| awaiting_approval | queued | operator_override | UTV2-1363 PM gate — discord:canary | 2026-06-29 10:23:08 |
| queued | posted | poster | discord:canary delivery — internal only | 2026-06-29 10:23:15 |
| posted | settled | settler | evidence settlement record confirmed | 2026-06-29 10:23:22 |

---

## Known Non-Blocking Bug

**UTV2-1362**: `pick_offer_snapshots_devig_mode_check` constraint — 787 failures. CLV resolves
correctly via `market_universe_provenance`. Fix required in settlement-service devig_mode value.

---

## Follow-Up Required

**UTV2-1364** — Candidate quality gates (created, not yet dispatched):
- Reject stale candidates (data_freshness / snapshot_age gate)
- Reject Kelly=0 / negative EV
- Reject SUPPRESS band
- Reject extreme juice
- Reject outside posting window
- Require enrichment
- Enforce market allowlist by sport
- Separate signal from bettable pick

Implementation of UTV2-1364 is the prerequisite for a PASS_FORWARD_FLOW attempt.
