# Smart Form V1 — Operator Submission Surface Contract

> **Milestone**: SMART_FORM_V1_OPERATOR_SUBMISSION_SURFACE
> **Tier**: T1 (operator-critical app surface, primary pipeline entry point)
> **Sprint model**: `docs/05_operations/SPRINT_MODEL_v2.md`

## Objective

Replace the current minimal smart form with a mobile-friendly, bet-slip-style, single-leg operator submission surface that enforces market-aware required fields, validates strictly, and creates truthful candidate picks through the existing V2 submission pipeline.

## Product Statement

Smart Form V1 is a mobile-friendly, speed-optimized, bet-slip-style single-leg entry surface for operators to create validated candidate picks quickly and accurately, with strict required-field guardrails, dynamic market-aware inputs, manual override capability, and additive enrichment — without auto-posting or auto-promotion by default.

## Scope

### In Scope

1. **Market-aware form** — five market types (player prop, moneyline, spread, total, team total) with conditional required fields per type
2. **Mobile-first UX** — one-column layout, large tap targets, sportsbook-style segmented controls, progressive field reveal
3. **Strict validation** — fail-closed on missing required fields, units enforced at 0.5–5.0, malformed odds rejected
4. **Bet-slip review** — compact summary card before submit showing all fields, validation status, enrichment availability
5. **Submit integration** — create candidate pick through existing `POST /api/submissions` endpoint, display success/failure with field-level errors
6. **Smart defaults** — date defaults to today, odds format defaults to American, market type requires intentional selection
7. **Enrichment visibility** — show domainAnalysis status (available/unavailable) and promotion evaluation result in submit response

### Out of Scope (Non-Goals)

- Parlays, round robins, teasers, multi-leg composition
- Public-facing or self-serve version
- Live odds shopping UI
- Analytics panels inside the form
- Edit/reopen workflows on existing picks
- Auto-post or auto-promote on submit
- API contract changes to `SubmissionPayload` (V1 maps rich fields through existing `metadata`)
- Legacy dual-path logic
- Lookup/autofill data sources (V1 supports manual entry with lookup as future enhancement)

## Architecture Constraints

1. **Single-writer discipline respected** — smart form writes to `bridge_outbox` or calls `POST /api/submissions`; never writes directly to `unified_picks` or `picks`
2. **Existing API endpoint** — V1 uses the current `POST /api/submissions` endpoint. No API schema changes required.
3. **Metadata mapping** — rich form fields (capper, sport, date, market type, player, matchup, stat type) are mapped into the existing `metadata` object on `SubmissionPayload`
4. **Fail-closed validation** — invalid submissions are blocked with clear field-level errors before API call
5. **No silent guessing** — core identity fields (player, matchup, market) never auto-filled without user confirmation
6. **Additive enrichment** — domainAnalysis and promotion evaluation happen server-side after persistence; the form displays results but does not control them

## Field Requirements

### Universal Required Fields (hard-block if missing)

| Field | Type | Validation |
|-------|------|------------|
| Capper | string | Non-empty |
| Date | date | Valid date, defaults to today |
| Sport | string | Non-empty |
| Market Type | enum | One of: player-prop, moneyline, spread, total, team-total |
| Selection / Side | string | Non-empty (constructed from market-specific inputs) |
| Odds | number | Valid American odds (non-zero finite integer) |
| Units | number | 0.5 ≤ units ≤ 5.0 |

### Universal Optional Fields (warn-only if missing)

| Field | Type | Notes |
|-------|------|-------|
| Sportsbook / Source | string | Warn if absent |
| Confidence | number | 0 < confidence < 1; enables edge/Kelly computation |

### Conditional Required Fields by Market Type

| Market Type | Additional Required Fields |
|-------------|---------------------------|
| Player Prop | Player, Matchup, Stat Type, Over/Under, Line |
| Moneyline | Matchup, Team/Side |
| Spread | Matchup, Team/Side, Line |
| Total | Matchup, Over/Under, Line |
| Team Total | Matchup, Team, Over/Under, Line |

### Validation Behavior

**Hard-block (prevent submit):**
- Any universal required field missing or invalid
- Any conditional required field missing for the selected market type
- Units outside 0.5–5.0
- Malformed odds (non-finite, zero)
- Malformed date
- Incomplete player prop identity (missing player + stat type + over/under + line)
- Incomplete game-line identity (missing matchup for any market type)

**Warn-only (allow submit with warning):**
- Sportsbook/source missing
- Confidence missing (disables edge/Kelly computation)
- Game time missing
- Enrichment unavailable

## Submission Behavior

On successful submit, V1:
1. Maps form fields to `SubmissionPayload` (market, selection, odds, stakeUnits, confidence, metadata)
2. Calls `POST /api/submissions`
3. Backend creates validated pick, computes domainAnalysis, runs eager promotion
4. Form displays success state with pick ID, lifecycle state, enrichment summary

On failed submit:
1. Form displays exact field-level blocking errors
2. Scrolls/focuses to first blocking issue
3. Preserves all entered values

V1 does **not** auto-post, auto-promote, or auto-settle.

## Payload Mapping

The form maps its rich field set into the existing `SubmissionPayload`:

```
SubmissionPayload.source       = 'smart-form'
SubmissionPayload.submittedBy  = form.capper
SubmissionPayload.market       = constructed from marketType + market-specific fields
SubmissionPayload.selection    = constructed from side/over-under + line
SubmissionPayload.line         = form.line (if applicable)
SubmissionPayload.odds         = form.odds
SubmissionPayload.stakeUnits   = form.units
SubmissionPayload.confidence   = form.confidence (if provided)
SubmissionPayload.eventName    = form.matchup
SubmissionPayload.metadata     = {
  capper: form.capper,
  sport: form.sport,
  date: form.date,
  marketType: form.marketType,
  sportsbook: form.sportsbook,
  player: form.player,           // player prop only
  statType: form.statType,       // player prop only
  overUnder: form.overUnder,     // where applicable
  team: form.team,               // where applicable
  eventName: form.matchup,
}
```

## Acceptance Criteria

1. A mobile-friendly single-leg operator form exists at `apps/smart-form`
2. Five market types with conditional required fields behave correctly
3. Invalid submissions fail closed with clear inline field errors
4. Units hard-enforced at 0.5–5.0
5. Form flow is fast, bet-slip-like, and mobile-usable
6. Manual entry works for all fields (no external lookup dependency)
7. Submission creates a truthful candidate pick via `POST /api/submissions`
8. Enrichment/domainAnalysis status is visible in the success response
9. No auto-post or auto-promotion occurs by default
10. Tests prove core validation behavior per market type and submit flow
11. `pnpm verify` passes with no regressions

## Build Phases

See spec doc for detailed build plan:
`docs/02_architecture/SMART_FORM_V1_OPERATOR_SUBMISSION_SPEC.md`

## Ratification

This contract is ratified as part of the Smart Form V1 Operator Submission Surface milestone.
