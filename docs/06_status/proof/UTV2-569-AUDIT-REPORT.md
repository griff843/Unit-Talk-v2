# UTV2-569 Mandatory Audit Report

**Date:** 2026-04-14
**Auditor:** Claude Code (Opus 4.6)
**Scope:** End-to-end verification of system-generated pick pipeline
**Verdict:** Wired but only partially proven

---

## Stage-by-Stage Verification Matrix

| Stage | Wired? | Running Live? | Proven with Real Data? | Verdict |
|-------|--------|---------------|------------------------|---------|
| A1. Provider ingestion | YES | YES | YES — 2.35M offers, 166K/24h | **PASS** |
| A2. market_universe materialization | YES | YES | YES — 4,595 rows, 3 sports, refreshed today | **PASS** |
| A3. system-pick-scanner canonical path | YES | NO — `SYSTEM_PICK_SCANNER_ENABLED=false` | N/A — quiesced since 2026-04-10 | **BLOCKED** |
| A4. alert-agent canonical path | YES | YES — governed path to market_universe | 7 picks exist in awaiting_approval | **PASS** |
| A5. Provider data coverage | YES | YES | NBA 1,935 / MLB 2,253 / NHL 407 market rows | **PASS** |
| B1. Board scan / candidate generation | YES | NO — `SYNDICATE_MACHINE_ENABLED=false` | 1,131 candidates, latest 2026-04-09 (stale) | **BLOCKED** |
| B2. Candidate filter logic | YES | N/A | 830 rejected, 301 qualified (289 shadow + 12 live) | **PARTIAL** |
| C1. Candidate scoring | YES | YES (always on, no flag) | model_registry EMPTY — fail-closed on every candidate | **FAIL** |
| C2. Model registry champions | YES | NO DATA | Zero rows in model_registry | **FAIL** |
| C3. Market family trust | YES | NO DATA | Zero rows in market_family_trust | **FAIL** |
| D1. Pick construction (promotion) | YES | Partial | 788 system-generated picks exist | **PARTIAL** |
| D2. Outbox enqueue for system picks | YES | NO | Zero system-generated picks in outbox | **FAIL** |
| D3. Governance brake (awaiting_approval) | YES | YES | 42 picks held at awaiting_approval (25 scanner + 10 model + 7 alert) | **WORKING AS DESIGNED** |
| E1. Distribution worker | YES | Only smart-form | 22 sent (all smart-form), 1 stuck pending since 4/10 | **FAIL** for system picks |
| E2. Discord embed fields | YES | N/A | Thumbnail fallback correct; fields populated from pick data | **PASS** (code review) |
| F1. Auto-settlement from game results | YES | NO | Zero auto-settlements ever. 16 operator voids only | **FAIL** |
| F2. CLV computation | YES (PR #288) | NO | Zero picks with CLV populated | **FAIL** |
| F3. P/L computation | YES | NO | Zero picks with P/L populated | **FAIL** |
| F4. Grading context | YES | NO | Zero settlement records with grading context | **FAIL** |
| F5. Correction chains | YES | N/A | Code handles corrects_id FK + cycle detection | **PASS** (code review) |
| G1. Operator-web pick detail | YES | YES | Full truth fields wired (CLV, game result, grading) | **PASS** |
| G2. Command-center pick detail | YES | PARTIAL | CLV values stripped to boolean `hasClv` flag only | **GAP** |
| G3. P/L surface | YES | NO | P/L computed but never surfaced in any UI | **FAIL** |

---

## Live DB Evidence (2026-04-14 19:01 UTC)

### Ingestion (HEALTHY)
- `provider_offers`: 2,346,744 total, 166,899 in last 24h, latest 19:01 UTC today
- `market_universe`: 4,595 rows, latest refresh 16:31 UTC today
- `game_results`: 279,499 total, 31,801 in last 7d, latest 18:33 UTC today
- `syndicate_board`: 3,708 entries (NBA 1,854 + MLB 1,854), latest today

### Candidates (STALE)
- Total: 1,131 candidates
- Latest: 2026-04-09 (5 days stale)
- Breakdown: 830 rejected (shadow), 289 qualified (shadow), 12 qualified (live)
- Linked to picks: 12 of 1,131

### Picks by Source
| Source | Status | Count | Latest |
|--------|--------|-------|--------|
| system-pick-scanner | validated | 757 | 2026-04-10 |
| system-pick-scanner | awaiting_approval | 25 | 2026-04-11 |
| smart-form | settled | 15 | 2026-04-05 |
| board-construction | validated | 13 | 2026-04-10 |
| model-driven | awaiting_approval | 10 | 2026-04-11 |
| alert-agent | awaiting_approval | 7 | 2026-04-11 |
| system-pick-scanner | queued | 4 | 2026-04-11 |

### Settlement (CRITICAL)
- Total settlement records: 16 (all source=operator, result=void)
- System-generated picks settled: **0**
- CLV on any pick: **0**
- P/L on any pick: **0**
- Auto-settlements from game results: **0**

### Model Infrastructure (EMPTY)
- model_registry rows: **0** (no champion models)
- market_family_trust rows: **0** (no trust calibration)

### Distribution (STALLED for system picks)
- Outbox total: 23 entries
- All entries: smart-form source only
- 1 entry stuck in `pending` since 2026-04-10

---

## Blocking Dependencies (ordered by pipeline position)

### Block 1: Feature Flags (2 flags)
- `SYSTEM_PICK_SCANNER_ENABLED=false` — quiesced since 2026-04-10 for DEBT-003
  - File: `local.env:61` with do-not-flip comment
  - Check: `apps/api/src/system-pick-scanner.ts:50`
  - Blocked on: DEBT-002 cleanup decision (PM approval)
- `SYNDICATE_MACHINE_ENABLED=false` — not even in local.env
  - Check: `apps/api/src/board-scan-service.ts:51-54`
  - Required for: board scan → candidate generation

### Block 2: Empty Model Registry
- `model_registry` has zero rows
- Scoring service (`candidate-scoring-service.ts:172-183`) fail-closes when no champion found (UTV2-553 policy)
- **This means:** Even if candidates are generated, they will never be scored
- Required: Seed champion models for at least one (sport, marketFamily) pair

### Block 3: Empty Trust Data
- `market_family_trust` has zero rows
- Trust adjustment (`candidate-scoring-service.ts:162-169`) will default to zero adjustment
- Not a hard blocker (scoring runs without it) but degrades accuracy

### Block 4: Governance Brake
- All autonomous sources (`system-pick-scanner`, `alert-agent`, `model-driven`) land in `awaiting_approval`
- `distribution-service.ts:99-104` throws `AwaitingApprovalBrakeError`
- **By design** in Phase 7A — requires operator to advance to `queued`
- 42 picks are currently held at this gate

### Block 5: No Auto-Settlement Path Proven
- Settlement service (`settlement-service.ts:104-245`) handles graded settlement
- Grading service (`grading-service.ts`) resolves game results → settlement
- **Never triggered for system-generated picks** — all 788 are pre-settlement lifecycle
- CLV computation (`clv-service.ts:48-141`) exists but has never been called on real data

---

## Truth Surface Gaps

### Gap 1: Command-Center CLV Data Stripped
- **operator-web** (`pick-detail.ts:435-437`) extracts `clvRaw`, `clvPercent`, `beatsClosingLine` from settlement payload
- **command-center** (`picks/[id]/page.tsx:64`) receives only `hasClv` boolean flag
- **Impact:** Operators using command-center cannot see actual CLV values

### Gap 2: Command-Center Missing Game Result Context
- **operator-web** derefs `evidence_ref` → `game_results` with events/participants join
- **command-center** `SettlementRow` type omits `gameResult`, `gradingContext`, `outcomeExplanation`
- **Impact:** No outcome rationale visible in command-center

### Gap 3: P/L Never Surfaced
- P/L computed in `settlement-service.ts` (American odds formula)
- Stored in `settlement_records.payload` JSON only (no column)
- **Neither operator-web nor command-center extract or display P/L**
- Only used for `computeFlatBetROI()` in domain module (on-read, not stored)

---

## Final Verdict

### H. Wired but only partially proven

The system-generated pick pipeline is **architecturally complete** — every stage from ingestion through settlement has implemented code with proper contracts, fail-closed semantics, and governed paths. The Phase 7A/7B architecture (governance brake, canonical intake, atomic lifecycle transitions) is correctly wired.

However, the end-to-end path from ingestion to settlement has **never completed for a system-generated pick**. The pipeline is blocked at three independent points:

1. **Feature flags** — Scanner and board scan both disabled
2. **Empty model registry** — Scoring will fail-closed even if candidates flow
3. **No auto-settlement precedent** — The grading→settlement→CLV path has never fired

### What works today (proven with live data):
- Provider ingestion: 166K offers/day across 3 sports
- Market universe materialization: 4,595 active market rows
- Game results ingestion: 31K results in last 7 days
- Syndicate board: 3,708 entries refreshed today
- Governance brake: Correctly holding 42 autonomous picks
- Operator surfaces: Wired to display full truth when data exists

### What has never happened:
- A system-generated pick being scored by a champion model
- A scored candidate being promoted and enqueued to the outbox
- A system-generated pick being delivered to Discord
- An auto-settlement triggered by game results
- CLV or P/L computed on any pick

---

## Recommended Follow-Up Issues

1. **Seed model_registry** — Register champion models for NBA/MLB/NHL to unblock scoring
2. **Enable SYNDICATE_MACHINE_ENABLED** — After model registry is seeded
3. **Resolve DEBT-002** — PM decision on stranded awaiting_approval cleanup
4. **Re-enable system-pick-scanner** — After DEBT-002 cleanup
5. **Command-center CLV/game-result parity** — Surface actual CLV values and game result context
6. **P/L surface** — Extract and display P/L in operator-web and command-center
7. **End-to-end smoke test** — Once blockers cleared, trace one pick through all 10 stages
