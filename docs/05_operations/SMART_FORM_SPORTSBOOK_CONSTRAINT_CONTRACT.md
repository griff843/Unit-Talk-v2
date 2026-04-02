# Smart Form Sportsbook Constraint Contract

**Status:** RATIFIED  
**Date:** 2026-04-02  
**Linear:** UTV2-302  
**Tier:** T1 — Contract / Validation

---

## Purpose

This contract defines:
1. Which market types are valid per sport (sport-market matrix)
2. Which sports require a team selection vs player selection (team vs non-team sports)
3. Which sportsbooks are available in the Smart Form
4. Invalid combination rules enforced at validation (fail-closed)
5. Manual fallback rules when canonical data is unavailable

---

## Sport-Market Type Matrix

Market types: `player-prop` | `moneyline` | `spread` | `total` | `team-total`

| Sport | player-prop | moneyline | spread | total | team-total |
|-------|:-----------:|:---------:|:------:|:-----:|:----------:|
| NBA   | ✓ | ✓ | ✓ | ✓ | ✓ |
| NFL   | ✓ | ✓ | ✓ | ✓ | ✓ |
| MLB   | ✓ | ✓ | ✓ | ✓ | ✓ |
| NHL   | ✓ | ✓ | ✓ | ✓ | ✓ |
| NCAAB | — | ✓ | ✓ | ✓ | — |
| NCAAF | — | ✓ | ✓ | ✓ | — |
| Soccer | — | ✓ | ✓ | ✓ | — |
| Tennis | — | ✓ | — | — | — |
| MMA   | — | ✓ | — | — | — |

**Source of truth:** `V1_REFERENCE_DATA.sports[*].marketTypes` in `packages/contracts/src/reference-data.ts`

Validation must fail-closed: if `(sport, marketType)` is not in this matrix, the submission is rejected with `FORM_VALIDATION_FAILED`.

---

## Team vs Non-Team Sports

**Team sports** (require a team/side field): NBA, NFL, MLB, NHL, NCAAB, NCAAF, Soccer

**Individual/non-team sports** (no team field): Tennis, MMA

| Sport | Requires Team/Side | Notes |
|-------|:-----------------:|-------|
| NBA   | ✓ | 30 teams in V1 catalog |
| NFL   | ✓ | 32 teams in V1 catalog |
| MLB   | ✓ | 30 teams in V1 catalog |
| NHL   | ✓ | 32 teams in V1 catalog |
| NCAAB | ✓ | Top programs in V1 catalog |
| NCAAF | ✓ | Top programs in V1 catalog |
| Soccer | ✓ | Displayed as "Club / Side" |
| Tennis | ✗ | Individual players; team field hidden |
| MMA   | ✗ | "Fighter" label used; no team selection |

For `player-prop` market type on team sports: both a **player name** and a **team/side** are required. For moneyline/spread/total on team sports: team/side is required, player name is optional.

For non-team sports (Tennis, MMA): player/fighter name is required; team field must not be shown.

---

## Sportsbook Catalog

The V1 sportsbook catalog (`V1_REFERENCE_DATA.sportsbooks`) contains:

| ID | Name |
|----|------|
| `draftkings` | DraftKings |
| `fanduel` | FanDuel |
| `betmgm` | BetMGM |
| `caesars` | Caesars |
| `pointsbet` | PointsBet |
| `bet365` | Bet365 |
| `barstool` | Barstool |
| `pinnacle` | Pinnacle |
| `bookmaker` | Bookmaker |
| `unibet` | Unibet |
| `twinspires` | TwinSpires |

All 11 sportsbooks are available as sportsbook selectors in the Smart Form. No sportsbook filtering by sport is applied — operators may post a pick regardless of sportsbook.

---

## Invalid Combination Rules (Fail-Closed)

The following combinations are explicitly invalid and must be rejected at form validation:

| Sport | Market Type | Reason |
|-------|-------------|--------|
| MMA | spread | MMA has no spread market |
| MMA | total | MMA has no total market |
| MMA | team-total | MMA has no team |
| MMA | player-prop | MMA uses moneyline only (fighter win/loss) |
| Tennis | spread | Tennis has no spread market |
| Tennis | total | Tennis has no total market |
| Tennis | team-total | Tennis has no team |
| Tennis | player-prop | Tennis uses moneyline only |
| NCAAB | player-prop | Not in V1 catalog — no player prop data |
| NCAAB | team-total | Not in V1 catalog |
| NCAAF | player-prop | Not in V1 catalog |
| NCAAF | team-total | Not in V1 catalog |
| Soccer | player-prop | Not in V1 catalog |
| Soccer | team-total | Not in V1 catalog |

**Validation error code:** `FORM_VALIDATION_FAILED`  
**Validation error message:** `Market type '{marketType}' is not available for sport '{sport}'`

---

## Manual Fallback Rules

The Smart Form must remain operable when the canonical reference data API is unavailable (network error, cold start). Fallback behavior:

1. **Sportsbook select**: render the full static V1 catalog (all 11 books). Never fall back to a free-text field.
2. **Sport select**: render the full static V1 catalog (all 9 sports). Never fall back to a free-text field.
3. **Market type select**: render only the market types valid for the selected sport per the hardcoded matrix above.
4. **Team/player names**: these are free-text fields with placeholder text — no autocomplete, no fallback needed.
5. **Validation**: always validate sport-market matrix locally (never skip validation because the API is down).

The static `V1_REFERENCE_DATA` in `packages/contracts/src/reference-data.ts` is the hardcoded fallback. The Smart Form must import or inline this data at build time.

---

## What NOT to Do

- Do not allow free-text sport or sportsbook entry — always constrain to catalog
- Do not show team-total or player-prop for non-team sports
- Do not skip sport-market validation when the reference data API is unavailable
- Do not add new sports or sportsbooks to the Smart Form without updating V1_REFERENCE_DATA first
- Do not show MMA or Tennis with team selection fields

---

## Cross-References

- `packages/contracts/src/reference-data.ts` — V1 catalog (authoritative)
- `docs/05_operations/SMART_FORM_V1_PHASE2_SPORT_FILTERING_AND_BETSLIP_UX_CONTRACT.md` — Phase 2 implementation history
- `docs/05_operations/T1_SMART_FORM_LIVE_OFFER_UX_CONTRACT.md` — live offer browse contract
- `docs/05_operations/T1_SMART_FORM_V1_CONTRACT.md` — core Smart Form contract
