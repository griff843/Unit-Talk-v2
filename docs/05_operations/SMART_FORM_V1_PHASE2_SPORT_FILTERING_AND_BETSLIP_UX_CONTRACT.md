# SMART_FORM_V1_PHASE2_SPORT_FILTERING_AND_BETSLIP_UX

> Historical implementation contract.
> This file documents an earlier `apps/smart-form/src/**` implementation path and is retained as sprint history only.
> It is not the active runtime authority for the current Next-based Smart Form surface under `apps/smart-form/app/**`.

**Status**: COMPLETE
**Sprint branch**: sprint/recap-field-alignment
**Contract type**: Implementation milestone

---

## Objective

Transform the Smart Form market-type section from a static 5-option control
into a sport-filtered bet-slip UX where:

1. Market types shown are constrained to those valid for the selected sport
2. Invalid sport/market combinations are rejected at validation (fail-closed)
3. The form reads like a bet-slip — constrained, mobile-friendly, fast
4. Labels, placeholders, and help text adapt per selected sport
5. Single-leg submission continues to work end-to-end

---

## Scope (Phase 2 only)

### IN SCOPE

- `apps/smart-form/src/validation.ts` — add sport-market type cross-validation
- `apps/smart-form/src/form-templates.ts` — market type card grid (2-col),
  sport-filtered display, sport-aware labels/placeholders, `__SF_SPORTS`
  extended with `marketTypes`, client JS `filterMarketTypes()`
- `apps/smart-form/src/validation.test.ts` — new sport-market combo tests
- `apps/smart-form/src/server.test.ts` — integration test for invalid sport/market
- `docs/05_operations/SMART_FORM_V1_PHASE2_SPORT_FILTERING_AND_BETSLIP_UX_CONTRACT.md` — this file

### NON-GOALS (do not implement)

- Multi-leg / parlay UI
- Live search for teams or players (no autocomplete)
- Odds format conversion (display-only)
- API-backed event lookup (no dropdowns for matchup)
- Leg-level odds calculation
- Ticket stacking / same-game parlay
- Changes to `payload-mapping.ts` or `reference-data-client.ts`
- Changes to any file in `packages/` or `apps/api/`
- Any migration or DB schema changes

---

## Acceptance Criteria

| # | Criterion |
|---|-----------|
| AC-1 | Selecting NBA shows: player-prop, spread, moneyline, over-under, futures |
| AC-2 | Selecting MMA shows only: moneyline |
| AC-3 | Selecting MMA + player-prop fails validation with code `FORM_VALIDATION_FAILED` |
| AC-4 | Sport change in UI immediately filters the market type options (client JS) |
| AC-5 | Sport-aware placeholder text: NBA → "Knicks vs Heat" / "Jalen Brunson", MMA → "Jones vs Miocic" / "Fighter" |
| AC-6 | Market type control is a 2-column card-style grid, not a segmented button row |
| AC-7 | All 5 `<fieldset class="bet-details">` still render (hidden/disabled) — only radio section filters |
| AC-8 | Valid single-leg NBA player-prop submission still passes end-to-end |
| AC-9 | Type check passes: `pnpm type-check` |
| AC-10 | All existing tests still pass |
| AC-11 | New validation tests cover: valid combo passes, invalid combo blocked, MMA has 1 option, NBA has 5 |

---

## Sport-Market Type Matrix

Market type IDs (from `MarketTypeId` in contracts): `player-prop`, `moneyline`, `spread`, `total`, `team-total`

| Sport | Market Types |
|-------|-------------|
| NBA | player-prop, moneyline, spread, total, team-total (all 5) |
| NFL | player-prop, moneyline, spread, total, team-total (all 5) |
| MLB | player-prop, moneyline, spread, total, team-total (all 5) |
| NHL | player-prop, moneyline, spread, total, team-total (all 5) |
| NCAAB | moneyline, spread, total |
| NCAAF | moneyline, spread, total |
| Soccer | moneyline, spread, total |
| Tennis | moneyline, spread, total |
| MMA | moneyline only |

---

## Sport Context Labels

| Sport | Player placeholder | Matchup placeholder | Team label |
|-------|-------------------|---------------------|-----------|
| NBA | Jalen Brunson | Knicks vs Heat | Team / Side |
| NFL | Patrick Mahomes | Bills vs Chiefs | Team / Side |
| MLB | Aaron Judge | Yankees vs Red Sox | Team / Side |
| NHL | Connor McDavid | Oilers vs Flames | Team / Side |
| NCAAB | Cooper Flagg | Duke vs Kentucky | Team / Side |
| NCAAF | Arch Manning | Texas vs Alabama | Team / Side |
| Soccer | Lionel Messi | Inter Miami vs LAFC | Club / Side |
| Tennis | Carlos Alcaraz | Djokovic vs Alcaraz | Player / Side |
| MMA | Jon Jones | Jones vs Miocic | Fighter |
| (none) | Player name | Team A vs Team B | Team / Side |

---

## Verification Gates

```bash
cd C:\dev\unit-talk-v2

# Type check
pnpm type-check

# Smart-form tests
cd apps/smart-form && npx tsx --test src/validation.test.ts src/payload-mapping.test.ts src/server.test.ts

# Full suite
cd ../.. && pnpm test
```

All must pass. Any failure = milestone incomplete.

---

## Codex Parallel Lane (Bounded Task)

**Permitted reads** (bounded read-only surface):
- `apps/smart-form/src/validation.ts`
- `apps/smart-form/src/form-templates.ts`
- `apps/smart-form/src/validation.test.ts`
- `apps/smart-form/src/server.test.ts`
- `packages/contracts/src/reference-data.ts`
- This contract doc

**Deliverables**:
1. Mobile UX inventory — which fields are awkward on 375px viewport
2. Validation edge-case matrix — all sport/market combos not yet tested
3. Field behavior checklist — what each field should do per market type
4. Filtering test checklist — JS client-side filter edge cases

**Forbidden touches** (must NOT write to):
- `form-templates.ts`, `server.ts`, `validation.ts` (implementation files)
- `docs/06_status/` or any status doc
- Any file in `packages/`, `apps/api/`, `supabase/`
- Any test fixture or seed data

---

## Completion Rule

This milestone is NOT complete until all of the following hold:

1. Sport-filtered market behavior is implemented
2. Invalid sport/market combinations are fail-closed (validation error returned)
3. Form feels more constrained and bet-slip-like than before
4. Current single-leg submission still works
5. Tests prove the new behavior
6. Docs match implemented reality
7. Clean commit on `sprint/recap-field-alignment`
