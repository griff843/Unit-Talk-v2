# UTV2-746 SGO Contract Hardening — Replay Audit & Trust Scorecard

**Status:** Complete
**Last updated:** 2026-04-27 (live DB replay run)
**Previous snapshot:** 2026-04-24 at SHA `c4b26b6` (pre-repoll, 0% graded)
**Evidence:** `docs/06_status/proof/UTV2-746/evidence.json`
**Scorecard docs:** `docs/05_operations/SGO_REPLAY_SCORECARD.md`, `docs/05_operations/SGO_CONTRACT_HARDENING.md`
**Replay script:** `scripts/proof/utv2-746-sgo-contract-replay-scorecard.ts`

---

## Post-Hardening Sprint Result (2026-04-27 Live Run)

The full hardening sprint (UTV2-664 → UTV2-745, 12 issues) plus UTV2-745 finalized-results repoll produced a **98.5% grading success rate** — up from 0% at the pre-sprint snapshot.

| Outcome | Count | % |
|---|---|---|
| Total in scope | 392 | — |
| **Graded (settled)** | **386** | **98.5%** |
| Skipped | 6 | 1.5% |

---

## Pass Rate by SGO Event Type (Sport × Market Family)

| Sport | Market Family | Attempted | Graded | Pass% | Skip Reason |
|---|---|---:|---:|---:|---|
| MLB | game_total | 40 | 40 | **100%** | — |
| MLB | player_prop | 255 | 255 | **100%** | — |
| MLB | unsupported | 5 | 0 | 0% | `unsupported_market_family` — moneyline not in grading contract (expected) |
| NBA | player_prop | 59 | 58 | **98.3%** | `game_result_not_found` × 1 (see §Failures) |
| NBA | unsupported | 1 | 1 | 100% | — (legacy moneyline settlement, pre-hardening) |
| NHL | game_total | 3 | 3 | **100%** | — |
| NHL | player_prop | 29 | 29 | **100%** | — |

**Gradeable families only (game_total + player_prop + team_total):** 386 / 387 = **99.7% pass rate**

---

## Failures Documented with Root Cause

### Failure 1: `unsupported_market_family` — 5 picks (MLB moneyline)

| Field | Detail |
|---|---|
| Market key | `moneyline` |
| Sport | MLB |
| Count | 5 picks |
| Root cause | `moneyline` is outside the SGO grading contract scope. `classifyMarketFamilyForGrading()` returns `{ family: 'unsupported', gradeable: false }`. Moneyline grading requires a different result resolution path (spread/winner, not over/under). |
| Action | No fix needed — expected behavior. These picks need a separate grading path (moneyline settlement) that is out of scope for SGO player-prop/totals contract. |
| Blocker | None — by design. |

### Failure 2: `game_result_not_found` — 1 pick (NBA `player_threes_ou`)

| Field | Detail |
|---|---|
| Market key | `player_threes_ou` |
| Sport | NBA |
| Event status | `completed` ✅ (event IS finalized) |
| Root cause | `player_threes_ou` is not in `COMMON_GRADING_MARKET_ALIASES` in `grading-service.ts`. The canonical result key `player_3pm_ou` IS present in `game_results` for this event, but the alias bridge is missing. `resolveGradingMarketKeyCandidates('player_threes_ou')` returns only `['player_threes_ou']` — no `player_3pm_ou` entry. |
| Fix | Add `player_threes_ou: 'player_3pm_ou'` (and reverse) to `COMMON_GRADING_MARKET_ALIASES` in `grading-service.ts`. |
| Blocker | None — narrow alias addition, T3. |

---

## Pre-Sprint vs. Post-Sprint Comparison

| Metric | Pre-Sprint (2026-04-23) | Post-Sprint (2026-04-27) | Delta |
|---|---|---|---|
| Graded | 0 (0%) | 386 (98.5%) | **+386 picks graded** |
| `event_not_completed` | 286 (87.7%) | 0 | ✅ cleared by UTV2-745 PR #454 |
| `missing_participant_id` | 40 (12.3%) | 0 | ✅ cleared (or moved to settled) |
| `game_result_not_found` | unknown | 1 (0.3%) | surfaces now that events complete |
| `unsupported_market_family` | unknown | 5 (1.3%) | moneyline — by design |

---

## Hardening Sprint Summary (UTV2-664 → UTV2-745)

12 issues Done. All rules canonicalized in contract matrix.

| Fix | Before Sprint | After Sprint |
|---|---|---|
| Grading result source | `results.game` (wrong) | `odds.<oddID>.score` ✅ UTV2-726 |
| Finalization gate | `status.completed` (unreliable) | `status.finalized` ✅ UTV2-734 |
| Finalized repoll | None — events stuck `in_progress` | Periodic repoll ✅ UTV2-745 PR #454 |
| CLV closing line coverage (MLB) | ~0% | **88.1%** ✅ UTV2-738 |
| CLV closing line coverage (NBA) | ~0% | **82.8%** ✅ UTV2-738 |
| PostgREST 1000-row cap | Silent truncation | Paginated `.range()` ✅ UTV2-738 |
| Legacy totals grading skip | 100% skip rate | Market key join fixed ✅ UTV2-733 |
| SGO request contract | 4 independent param builders | Centralized module ✅ UTV2-743 |
| Historical open/close odds | Missing `includeOpenCloseOdds=true` | Fixed ✅ UTV2-721 |
| Market key normalization | Raw SGO key in grading join | Canonical form ✅ UTV2-664 |

---

## Remaining Gaps

| Gap | Severity | Issue | State |
|---|---|---|---|
| `player_threes_ou → player_3pm_ou` alias missing in grading-service.ts | T3 | new | Narrow fix, unblocked |
| Participant-aware market aliasing in materializer | T1 | UTV2-732 | Codex lane active |
| `scoringSupported=true` hard gate | T1 | UTV2-742 | Ready for Codex |
| `includeOpenCloseOdds=true` always in historical | T1 | UTV2-744 | Ready for Codex |
| R5 replay CLV ROI proof | T2 | UTV2-736 | Blocked (needs UTV2-732+745 data) |
| `event_id` FK in market_universe | — | deferred | Phase 3 |

---

## Acceptance Criteria

| Criterion | Status |
|---|---|
| Scorecard shows pass rate by SGO event type | ✅ PASS — see §Pass Rate table above |
| Failures documented with root cause | ✅ PASS — 2 failure types, root causes documented in §Failures |
