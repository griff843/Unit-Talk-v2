# Smart Form V1 — Operator Submission Surface Contract

> **Milestone**: SMART_FORM_V1_OPERATOR_SUBMISSION_SURFACE
> **Tier**: T1 (operator-critical app surface, primary pipeline entry point)
> **Sprint model**: `docs/05_operations/SPRINT_MODEL_v2.md`
> **Revision**: R2 (2026-03-21) — Taxonomy, reference-data, numeric guardrails corrected

## Objective

Replace the current minimal smart form with a mobile-friendly, bet-slip-style operator submission surface that enforces sport-aware, market-aware required fields, validates strictly against canonical reference data, and creates truthful candidate picks through the existing V2 submission pipeline.

## Product Statement

Smart Form V1 is a mobile-friendly, speed-optimized, bet-slip-style entry surface for operators to create validated candidate picks quickly and accurately, with:
- **Dependency-driven field behavior** (sport → market type → stat type → team)
- **Governed identity fields** drawn from canonical reference data, not free text
- **Strict numeric guardrails** on odds, units, and line values
- **Correct ticket/market taxonomy** distinguishing ticket type from market type
- **No auto-posting or auto-promotion** by default

## Scope

### In Scope

1. **Ticket taxonomy** — Ticket Type (single, parlay, teaser, etc.) and Market Type (player prop, moneyline, spread, total, team total) modeled as separate dimensions. V1 implementation enables **Single ticket type only**; taxonomy must be correct for future extension.
2. **Sport-driven field behavior** — selecting a sport filters available market types, stat types, and teams. No cross-sport option leakage.
3. **Governed identity fields** — Capper, Sportsbook, Sport, Team, Market Type, Stat Type rendered as controlled selects backed by reference data, not free text.
4. **Mobile-first UX** — one-column layout, large tap targets, sportsbook-style segmented controls, progressive field reveal
5. **Strict validation** — fail-closed on missing required fields, strict numeric guardrails, reference-data-aware value enforcement
6. **Bet-slip review** — compact summary card before submit showing all fields, validation status, enrichment availability
7. **Submit integration** — create candidate pick through existing `POST /api/submissions` endpoint, display success/failure with field-level errors
8. **Smart defaults** — date defaults to today, odds format defaults to American, units defaults to 1.0

### Out of Scope (Non-Goals)

- Multi-leg ticket submission (parlay, teaser, round robin) — V1 is Single-only
- Public-facing or self-serve version
- Live odds shopping UI
- Analytics panels inside the form
- Edit/reopen workflows on existing picks
- Auto-post or auto-promote on submit
- API contract changes to `SubmissionPayload` (V1 maps rich fields through existing `metadata`)
- Legacy dual-path logic

## Ticket Taxonomy

### Ticket Type vs Market Type — Separate Dimensions

**Ticket Type** describes the structure of a wager:

| Ticket Type | Legs | V1 Status |
|-------------|------|-----------|
| Single | 1 | **Enabled** |
| Parlay | 2+ | Modeled, not enabled |
| Teaser | 2+ (adjusted lines) | Modeled, not enabled |
| Round Robin | 3+ (parlay combinations) | Modeled, not enabled |
| Future | 1 (long-dated) | Modeled, not enabled |

**Market Type** describes what is being wagered on within a single leg:

| Market Type | Required Fields | Sport-Specific Behavior |
|-------------|----------------|------------------------|
| Player Prop | Player, Matchup, Stat Type, Over/Under, Line | Stat types filtered by sport |
| Moneyline | Matchup, Team/Side | Teams filtered by sport |
| Spread | Matchup, Team/Side, Line | Teams filtered by sport |
| Total | Matchup, Over/Under, Line | — |
| Team Total | Matchup, Team, Over/Under, Line | Teams filtered by sport |

V1 submits the ticket type in `metadata.ticketType` and validates that only `single` is accepted.

## Architecture Constraints

1. **Single-writer discipline respected** — smart form writes to `bridge_outbox` or calls `POST /api/submissions`; never writes directly to `unified_picks` or `picks`
2. **Existing API endpoint** — V1 uses the current `POST /api/submissions` endpoint. No API schema changes required.
3. **Metadata mapping** — rich form fields are mapped into the existing `metadata` object on `SubmissionPayload`
4. **Fail-closed validation** — invalid submissions are blocked with clear field-level errors before API call
5. **No silent guessing** — core identity fields never auto-filled without user confirmation
6. **Additive enrichment** — domainAnalysis and promotion evaluation happen server-side after persistence; the form displays results but does not control them
7. **Reference-data authority** — selectable governed fields must be sourced from canonical reference data, not hard-coded UI constants (see Reference-Data Architecture below)

## Reference-Data Architecture

### Hard Rule

**Smart Form must not rely on hard-coded option catalogs for governed submission entities.**

Selectable values for governed fields must derive from one of:
1. A canonical reference-data endpoint (`GET /api/reference-data/{entity}`)
2. A governed shared config module in `packages/contracts/` or `packages/config/`
3. Seeded reference tables in the database

### Governed Fields

| Field | Source | Must Match Backend |
|-------|--------|--------------------|
| Capper | Reference data (operator allowlist) | Yes — `submittedBy` must be a known capper |
| Sport | Reference data (supported sports) | Yes — drives downstream filtering |
| Sportsbook | Reference data (known books) | Yes — aligns with `book-profiles.ts` |
| Team | Reference data (teams by sport) | Yes — must be valid team for selected sport |
| Market Type | Reference data (market types by sport) | Yes — determines required fields |
| Stat Type | Reference data (stat types by sport + market type) | Yes — must be valid for sport |
| Ticket Type | Reference data (supported ticket structures) | Yes — V1: single only |

### Degradation Behavior

If reference data is unavailable at form render time:
- **Fail closed**: do not fall back to stale hard-coded catalogs silently
- **Degrade explicitly**: show an error state explaining reference data is unavailable
- **Allow manual override**: provide a "manual entry" escape hatch for operators, but flag submissions using manual entry with `metadata.manualEntry: true`

### Server-Side Enforcement

Both the smart form server and the API backend must enforce the same allowed-value truth:
- Smart form validates against reference data before submission
- API validates the same constraints as a safety net
- A value accepted by the form must be accepted by the API; a value rejected by the form must also be rejected by the API

## Field Requirements

### Universal Required Fields (hard-block if missing)

| Field | Control Type | Validation |
|-------|-------------|------------|
| Capper | controlled select | Must be a known capper from reference data |
| Date | date input | Valid date (YYYY-MM-DD), defaults to today |
| Sport | controlled select | Must be a supported sport from reference data |
| Ticket Type | controlled select | Must be a supported ticket type; V1: `single` only |
| Market Type | segmented control | Must be valid for the selected sport |
| Odds Format | segmented: American / Decimal | Required, defaults to American |
| Odds | number input | See Numeric Guardrails below |
| Units | number input (step 0.5) | See Numeric Guardrails below |

### Universal Optional Fields (warn-only if missing)

| Field | Control Type | Notes |
|-------|-------------|-------|
| Sportsbook | controlled select | Warn if absent; values from reference data |

### Conditional Required Fields by Market Type

| Market Type | Additional Required Fields |
|-------------|---------------------------|
| Player Prop | Player (text), Matchup (text), Stat Type (controlled select, sport-filtered), Over/Under (segmented), Line (number) |
| Moneyline | Matchup (text), Team/Side (controlled select, sport-filtered) |
| Spread | Matchup (text), Team/Side (controlled select, sport-filtered), Line (number) |
| Total | Matchup (text), Over/Under (segmented), Line (number) |
| Team Total | Matchup (text), Team (controlled select, sport-filtered), Over/Under (segmented), Line (number) |

### Field Control Types

| Control Type | Behavior |
|-------------|----------|
| **controlled select** | Dropdown/search-select populated from reference data. No arbitrary free text accepted unless manual override is explicitly activated. |
| **segmented control** | Tap-bar with fixed options (e.g., Over/Under, American/Decimal). |
| **text input** | Free text allowed. Used only for fields without canonical data (Player name, Matchup description). |
| **number input** | Numeric entry with explicit step, min, max, and inputmode attributes. |

### Confidence — Removed from V1

**Decision**: Confidence is **removed** from the Smart Form V1 operator surface.

**Rationale**:
- Confidence (0 < x < 1) is a derived analytical signal, not an operator-entry field
- The domainAnalysis pipeline already computes `impliedProbability`, `edge`, and `kellyFraction` from odds at submission time
- Operator-entered confidence has no defined calibration standard and no downstream consumer that prefers it over computed signals
- If reintroduced in a future version, it must have: defined semantics, calibration reference, min/max/step, and a downstream consumer that uses it

The `confidence` field on `SubmissionPayload` remains available for programmatic API consumers but is not exposed in the operator form.

## Numeric Guardrails

### Units

| Rule | Value |
|------|-------|
| Min | 0.5 |
| Max | 5.0 |
| Step | 0.5 |
| Default | 1.0 |
| Input mode | `decimal` |
| Validation | Must be a finite number, 0.5 ≤ x ≤ 5.0 |

### Odds — American Format

| Rule | Value |
|------|-------|
| Type | Integer |
| Non-zero | Required (0 is invalid) |
| Positive range | +100 to +50000 |
| Negative range | -100 to -50000 |
| Forbidden | ±0, fractions, values between -99 and +99 (exclusive of ±100) |
| Input mode | `numeric` |

### Odds — Decimal Format

| Rule | Value |
|------|-------|
| Type | Number (2 decimal places) |
| Min | 1.01 |
| Max | 501.00 |
| Step | 0.01 |
| Input mode | `decimal` |
| Conversion | Form converts decimal → American before submission |

### Line

| Rule | Value |
|------|-------|
| Type | Number |
| Step | 0.5 (standard) |
| Range | -999.5 to +999.5 |
| Required when | Player prop, spread, total, team total |
| Not required when | Moneyline |
| Input mode | `decimal` |
| Market-aware | Spread lines may be negative or positive; prop/total lines are typically positive |

## Dependency-Driven Field Behavior

### Selection Cascade

```
Sport  →  filters  →  Market Type options
Sport  →  filters  →  Team options
Sport + Market Type  →  filters  →  Stat Type options (player prop only)
```

### Rules

1. **Sport filters Market Type**: Not all market types are valid for all sports. Reference data defines which market types are available per sport. If a sport has no player prop stat types defined, player prop may be unavailable for that sport.

2. **Sport filters Team**: Team select options are populated from teams registered for the selected sport. If sport changes, team selection resets.

3. **Sport + Market Type filters Stat Type**: For player prop markets, stat type options come from reference data keyed by sport. NBA stat types (Points, Rebounds, Assists, etc.) must not appear when NHL is selected.

4. **Market Type drives Section 3 fields**: Selecting a market type reveals only the relevant conditional fields. Switching market type resets conditional field values.

5. **Ticket Type determines submission structure**: V1 enforces single-leg only. The ticket type field is set to `single` and locked in V1.

## Validation Behavior

**Hard-block (prevent submit):**
- Any universal required field missing or invalid
- Any conditional required field missing for the selected market type
- Units outside 0.5–5.0
- American odds: non-integer, zero, or outside ±100 to ±50000
- Decimal odds: below 1.01 or above 501.00
- Line outside ±999.5 where required
- Malformed date
- Capper not in reference-data allowlist (unless manual override)
- Sport not in reference-data supported list
- Stat type not valid for selected sport (unless manual override)
- Team not valid for selected sport (unless manual override)
- Ticket type not `single` (V1 constraint)

**Warn-only (allow submit with warning):**
- Sportsbook not provided
- Manual override activated for any governed field

## Submission Behavior

On successful submit, V1:
1. Maps form fields to `SubmissionPayload` (market, selection, odds, stakeUnits, metadata)
2. Calls `POST /api/submissions`
3. Backend creates validated pick, computes domainAnalysis, runs eager promotion
4. Form displays success state with pick ID, lifecycle state, enrichment summary

On failed submit:
1. Form displays exact field-level blocking errors
2. Scrolls/focuses to first blocking issue
3. Preserves all entered values

V1 does **not** auto-post, auto-promote, or auto-settle.

## Payload Mapping

```
SubmissionPayload.source       = 'smart-form'
SubmissionPayload.submittedBy  = form.capper
SubmissionPayload.market       = constructed from sport + marketType + market-specific fields
SubmissionPayload.selection    = constructed from side/over-under + line
SubmissionPayload.line         = form.line (if applicable)
SubmissionPayload.odds         = form.odds (American; converted if entered as Decimal)
SubmissionPayload.stakeUnits   = form.units
SubmissionPayload.eventName    = form.matchup
SubmissionPayload.metadata     = {
  capper, sport, date, ticketType, marketType, sportsbook,
  player, statType, overUnder, team, eventName,
  manualEntry (if any governed field used manual override)
}
```

## Acceptance Criteria

1. A mobile-friendly single-leg operator form exists at `apps/smart-form`
2. Ticket Type and Market Type are modeled as separate dimensions
3. V1 accepts only ticket type `single`; taxonomy is correct for future extension
4. Sport selection drives filtering of market types, stat types, and teams
5. Governed identity fields (capper, sportsbook, sport, team, stat type) use controlled selects backed by reference data
6. No hard-coded option catalogs embedded in UI code for governed entities
7. American odds validated as integer, non-zero, ±100 to ±50000
8. Decimal odds validated as 1.01–501.00, converted to American before submission
9. Units hard-enforced at 0.5–5.0
10. Line validated as finite number within ±999.5
11. Confidence is not present on the operator form
12. Invalid submissions fail closed with clear inline field errors
13. Form flow is fast, bet-slip-like, and mobile-usable
14. Submission creates a truthful candidate pick via `POST /api/submissions`
15. Enrichment/domainAnalysis status is visible in the success response
16. No auto-post or auto-promotion occurs by default
17. Tests prove validation, reference-data filtering, and submit flow
18. `pnpm verify` passes with no regressions

## Build Phases

See spec doc for detailed build plan:
`docs/02_architecture/SMART_FORM_V1_OPERATOR_SUBMISSION_SPEC.md`

## Ratification

This contract is ratified as R2 of the Smart Form V1 Operator Submission Surface milestone.
Supersedes R1 (initial contract before taxonomy/reference-data corrections).
