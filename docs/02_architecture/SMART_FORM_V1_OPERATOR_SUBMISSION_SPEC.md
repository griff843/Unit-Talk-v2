# Smart Form V1 — Operator Submission Surface Spec

> **Contract**: `docs/05_operations/SMART_FORM_V1_OPERATOR_SUBMISSION_CONTRACT.md`
> **Sprint model**: `docs/05_operations/SPRINT_MODEL_v2.md`
> **Revision**: R2 (2026-03-21) — Taxonomy, reference-data, numeric guardrails corrected

## 1. Technology

Smart Form V1 is built as a server-rendered HTML surface on the existing `apps/smart-form` Node.js HTTP server. No frontend framework. No build toolchain beyond TypeScript. The form is embedded as template functions in TypeScript source files.

This matches the existing pattern in V2 (operator-web and current smart-form both use this approach).

## 2. Reference-Data Layer

### Architecture Rule

**Smart Form must not embed hard-coded option catalogs for governed entities.**

All governed selects must be populated from a reference-data source at render time. The reference-data layer is the single source of truth for allowed values.

### Reference-Data Module

```
packages/contracts/src/
├── reference-data.ts           # Canonical types + static reference data
└── ... (existing files)

apps/smart-form/src/
├── reference-data-client.ts    # Fetches/resolves reference data for form rendering
└── ... (existing files)
```

### Governed Entities

```typescript
// packages/contracts/src/reference-data.ts

interface ReferenceDataCatalog {
  cappers: CapperEntry[];
  sports: SportEntry[];
  sportsbooks: SportsbookEntry[];
  ticketTypes: TicketTypeEntry[];
  marketTypes: MarketTypeEntry[];       // keyed by sport
  statTypes: StatTypeEntry[];           // keyed by sport
  teams: TeamEntry[];                   // keyed by sport
}

interface CapperEntry {
  id: string;           // e.g., 'griff843'
  displayName: string;
}

interface SportEntry {
  id: string;           // e.g., 'NBA', 'NFL'
  displayName: string;
  marketTypes: string[];  // which market types are valid for this sport
}

interface SportsbookEntry {
  id: string;           // e.g., 'draftkings'
  displayName: string;  // e.g., 'DraftKings'
}

interface TicketTypeEntry {
  id: string;           // e.g., 'single', 'parlay'
  displayName: string;
  enabled: boolean;     // V1: only 'single' is true
  maxLegs: number;      // single=1, parlay=12, etc.
}

interface MarketTypeEntry {
  id: string;           // e.g., 'player-prop', 'moneyline'
  displayName: string;  // e.g., 'Player Prop', 'Moneyline'
}

interface StatTypeEntry {
  id: string;           // e.g., 'points', 'rebounds'
  displayName: string;  // e.g., 'Points', 'Rebounds'
  sport: string;        // which sport this stat type belongs to
}

interface TeamEntry {
  id: string;           // e.g., 'knicks'
  displayName: string;  // e.g., 'Knicks'
  sport: string;        // which sport this team belongs to
}
```

### V1 Implementation Strategy

For V1, reference data may be served from a static governed config in `packages/contracts/` rather than a database-backed API endpoint. This is acceptable because:
- The operator count is small (1-3 cappers)
- Sports, sportsbooks, teams are stable enough for static config
- The contract requires the data to be in a shared package, not in UI code

The form server reads reference data at render time from the shared config module. If reference data is unavailable, the form degrades explicitly (not silently).

### Future: API-Backed Reference Data

When the platform grows beyond static config scale, the reference-data source transitions to:
- `GET /api/reference-data/sports` — supported sports
- `GET /api/reference-data/teams?sport=NBA` — teams for a sport
- `GET /api/reference-data/stat-types?sport=NBA` — stat types for a sport
- `GET /api/reference-data/sportsbooks` — known sportsbooks
- `GET /api/reference-data/cappers` — authorized cappers

The form server's `reference-data-client.ts` abstracts this transition. The form templates do not know or care whether data comes from a config module or an API.

## 3. Ticket Taxonomy

### Ticket Type (submission structure)

| ID | Display Name | Max Legs | V1 Enabled |
|----|-------------|----------|------------|
| `single` | Single | 1 | Yes |
| `parlay` | Parlay | 12 | No |
| `teaser` | Teaser | 12 | No |
| `round-robin` | Round Robin | 12 | No |
| `future` | Future | 1 | No |

V1 implementation: ticket type is set to `single` and locked. The form renders it as a read-only indicator, not a selectable field, until multi-leg ticket types are enabled.

### Market Type (per-leg wager type)

| ID | Display Name | Requires Line | Requires Team | Requires Over/Under | Requires Stat Type |
|----|-------------|--------------|--------------|--------------------|--------------------|
| `player-prop` | Player Prop | Yes | No | Yes | Yes (sport-filtered) |
| `moneyline` | Moneyline | No | Yes | No | No |
| `spread` | Spread | Yes | Yes | No | No |
| `total` | Total | Yes | No | Yes | No |
| `team-total` | Team Total | Yes | Yes | Yes | No |

Market type availability is filtered by sport. Reference data defines which market types are valid per sport.

## 4. Form Structure

### Section 1 — Ticket Basics

| Field | Control | Default | Required | Validation |
|-------|---------|---------|----------|------------|
| Capper | controlled select | — | Hard | Must be in reference-data capper list |
| Date | date input | Today | Hard | Valid date (YYYY-MM-DD) |
| Sport | controlled select | — | Hard | Must be in reference-data sport list |
| Sportsbook | controlled select | — | Warn | Warn if empty; values from reference data |
| Units | number input (step 0.5) | 1.0 | Hard | 0.5 ≤ x ≤ 5.0 |
| Odds Format | segmented: American / Decimal | American | Hard | — |
| Odds | number input | — | Hard | See Numeric Guardrails |

### Section 2 — Ticket Type + Market Type

**Ticket Type**: Read-only indicator showing `Single` (V1 locked).

**Market Type**: Segmented control filtered by selected sport. Options come from reference data. Selecting a market type reveals Section 3 fields.

### Section 3 — Bet Details (dynamic, market-type-dependent)

#### Player Prop

| Field | Control | Required | Validation |
|-------|---------|----------|------------|
| Player | text input | Hard | Non-empty |
| Matchup | text input | Hard | Non-empty (e.g., "Knicks vs Heat") |
| Stat Type | controlled select (sport-filtered) | Hard | Must be valid for selected sport |
| Over / Under | segmented: Over / Under | Hard | Must select one |
| Line | number input (step 0.5) | Hard | Finite number, -999.5 to +999.5 |

**Constructed fields:**
- `market` = `"{Sport} {StatType}"` (e.g., "NBA Points")
- `selection` = `"{Player} {Over/Under} {Line}"` (e.g., "Jalen Brunson Over 24.5")

#### Moneyline

| Field | Control | Required | Validation |
|-------|---------|----------|------------|
| Matchup | text input | Hard | Non-empty |
| Team / Side | controlled select (sport-filtered) | Hard | Must be valid for selected sport |

**Constructed fields:**
- `market` = `"{Sport} Moneyline"`
- `selection` = `"{Team}"` (e.g., "Knicks")

#### Spread

| Field | Control | Required | Validation |
|-------|---------|----------|------------|
| Matchup | text input | Hard | Non-empty |
| Team / Side | controlled select (sport-filtered) | Hard | Must be valid for selected sport |
| Line | number input (step 0.5) | Hard | Finite number, -999.5 to +999.5 |

**Constructed fields:**
- `market` = `"{Sport} Spread"`
- `selection` = `"{Team} {Line}"` (e.g., "Knicks -3.5")

#### Total

| Field | Control | Required | Validation |
|-------|---------|----------|------------|
| Matchup | text input | Hard | Non-empty |
| Over / Under | segmented: Over / Under | Hard | Must select one |
| Line | number input (step 0.5) | Hard | Finite number, -999.5 to +999.5 |

**Constructed fields:**
- `market` = `"{Sport} Total"`
- `selection` = `"{Over/Under} {Line}"` (e.g., "Over 215.5")

#### Team Total

| Field | Control | Required | Validation |
|-------|---------|----------|------------|
| Matchup | text input | Hard | Non-empty |
| Team | controlled select (sport-filtered) | Hard | Must be valid for selected sport |
| Over / Under | segmented: Over / Under | Hard | Must select one |
| Line | number input (step 0.5) | Hard | Finite number, -999.5 to +999.5 |

**Constructed fields:**
- `market` = `"{Sport} Team Total"`
- `selection` = `"{Team} {Over/Under} {Line}"` (e.g., "Knicks Over 108.5")

### Section 4 — Review Card

Compact bet-slip-style summary rendered inline before the submit button:

```
┌─────────────────────────────────┐
│  Capper: griff843               │
│  Sport: NBA                     │
│  Type: Single                   │
│  Market: NBA Points             │
│  Pick: Jalen Brunson Over 24.5  │
│  Odds: -110                     │
│  Units: 1.5                     │
│                                 │
│  ✓ All required fields present  │
│  ⚠ Sportsbook not provided     │
│  ✓ Odds valid for enrichment    │
└─────────────────────────────────┘

       [ Submit Pick ]
```

### Section 5 — Submit Result

**Success:**
```
┌─────────────────────────────────┐
│  ✓ Pick created                 │
│                                 │
│  Pick ID: abc-123               │
│  Lifecycle: validated           │
│  Domain Analysis: computed      │
│  Promotion: best-bets qualified │
│                                 │
│     [ Submit Another ]          │
└─────────────────────────────────┘
```

**Failure:**
```
┌─────────────────────────────────┐
│  ✗ Submission failed            │
│                                 │
│  • Player is required           │
│  • Line is required             │
│                                 │
│     [ Fix and Retry ]           │
└─────────────────────────────────┘
```

## 5. Numeric Guardrails

### Units
- **Type**: Number
- **Step**: 0.5
- **Range**: 0.5–5.0 (inclusive)
- **Default**: 1.0
- **Reject**: non-finite, NaN, outside range

### American Odds
- **Type**: Integer
- **Non-zero**: required
- **Positive range**: +100 to +50000
- **Negative range**: -100 to -50000 (i.e., -50000 ≤ x ≤ -100)
- **Forbidden zone**: values between -99 and +99 are not valid American odds
- **Reject**: fractions, non-finite, zero, outside range

### Decimal Odds
- **Type**: Number (max 2 decimal places)
- **Range**: 1.01–501.00
- **Conversion**: `decimal >= 2.0 → American = round((decimal - 1) × 100)`, `decimal < 2.0 → American = round(-100 / (decimal - 1))`
- **Reject**: ≤ 1.0, non-finite, outside range

### Line
- **Type**: Number
- **Step**: 0.5 (standard for most markets)
- **Range**: -999.5 to +999.5
- **Required when**: player-prop, spread, total, team-total
- **Not required when**: moneyline
- **Reject**: non-finite, outside range

## 6. Mobile UX Rules

- **Layout**: Single column, max-width 480px centered, full-width on small screens
- **Tap targets**: Minimum 44px height for all interactive elements
- **Segmented controls**: Full-width tap bars for Market Type, Over/Under, Odds Format
- **Controlled selects**: Native `<select>` on mobile (triggers OS picker), search-select on desktop if reference data > 20 items
- **Numeric inputs**: Use `inputmode="decimal"` or `inputmode="numeric"` to trigger mobile number keyboard
- **Progressive reveal**: Section 3 fields appear only after market type is selected
- **Cascade reset**: Changing sport resets market type, stat type, and team selections
- **Scroll behavior**: On validation failure, scroll to first error field
- **No horizontal scroll**: All content fits within viewport width

## 7. Validation Engine

### Client-Side (Smart Form Server)

Validation runs on `POST /submit` before calling the API.

```typescript
interface FieldError {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

function validateSmartFormSubmission(
  form: ParsedFormBody,
  marketType: MarketType,
  referenceData: ReferenceDataCatalog,
): FieldError[]
```

The validation function now takes reference data as a parameter to validate governed fields against canonical allowed values.

**Error severity:**
- `error` → blocks submit, shown in red
- `warning` → allows submit, shown in amber

### Server-Side (API)

The existing API validation (`validateSubmissionPayload`) remains unchanged. The smart form's richer validation runs before the API call, so the API acts as a safety net, not the primary validator.

## 8. Payload Mapping

```typescript
function mapSmartFormToSubmissionPayload(
  form: ParsedFormBody,
  marketType: MarketType,
): SubmissionPayload {
  const market = constructMarket(form.sport, marketType, form.statType);
  const selection = constructSelection(marketType, form);

  return {
    source: 'smart-form',
    submittedBy: form.capper,
    market,
    selection,
    line: form.line,
    odds: normalizeOdds(form.odds, form.oddsFormat),
    stakeUnits: form.units,
    eventName: form.matchup,
    metadata: {
      capper: form.capper,
      sport: form.sport,
      date: form.date,
      ticketType: 'single',
      marketType: form.marketType,
      sportsbook: form.sportsbook,
      ...(form.player ? { player: form.player } : {}),
      ...(form.statType ? { statType: form.statType } : {}),
      ...(form.overUnder ? { overUnder: form.overUnder } : {}),
      ...(form.team ? { team: form.team } : {}),
      ...(form.manualEntry ? { manualEntry: true } : {}),
      eventName: form.matchup,
    },
  };
}
```

**Market construction examples:**
| Market Type | Sport | Other Fields | Constructed `market` |
|-------------|-------|-------------|---------------------|
| player-prop | NBA | statType=Points | "NBA Points" |
| moneyline | NFL | — | "NFL Moneyline" |
| spread | NBA | — | "NBA Spread" |
| total | NHL | — | "NHL Total" |
| team-total | NBA | — | "NBA Team Total" |

**Selection construction examples:**
| Market Type | Fields | Constructed `selection` |
|-------------|--------|----------------------|
| player-prop | player=Brunson, overUnder=Over, line=24.5 | "Jalen Brunson Over 24.5" |
| moneyline | team=Knicks | "Knicks" |
| spread | team=Knicks, line=-3.5 | "Knicks -3.5" |
| total | overUnder=Over, line=215.5 | "Over 215.5" |
| team-total | team=Knicks, overUnder=Over, line=108.5 | "Knicks Over 108.5" |

## 9. File Structure

```
packages/contracts/src/
├── reference-data.ts               # NEW: Reference data types + static catalog
└── ... (existing)

apps/smart-form/src/
├── index.ts                        # Entry point (no change)
├── server.ts                       # Routing + form orchestration
├── server.test.ts                  # Integration tests
├── validation.ts                   # Validation engine (reference-data-aware)
├── validation.test.ts              # Validation tests
├── payload-mapping.ts              # Form → SubmissionPayload mapping
├── payload-mapping.test.ts         # Mapping tests
├── form-templates.ts               # HTML template functions
└── reference-data-client.ts        # NEW: Reference data resolution
```

## 10. Build Plan

### Phase 2 — Reference Data + Governed Controls (T2)

**Scope:** Create reference-data module, replace hard-coded catalogs with governed selects, add sport-filtering cascade, add ticket type dimension.

**Deliverables:**
- `packages/contracts/src/reference-data.ts` — types and static reference data catalog
- `reference-data-client.ts` — form-side reference data resolution
- Updated `validation.ts` — reference-data-aware validation (capper, sport, team, stat type)
- Updated `form-templates.ts` — controlled selects from reference data, sport-filtering JS, ticket type indicator
- Updated `payload-mapping.ts` — add `ticketType: 'single'` to metadata, remove confidence
- Updated tests — reference-data validation, sport-filtering, controlled select behavior
- Updated numeric guardrails — American odds ±100–±50000 range, decimal 1.01–501.00, line ±999.5

**Not included:** Multi-leg ticket types, API-backed reference data endpoints.

**Test target:** Governed fields reject values outside reference data. Sport filtering produces correct option sets. Numeric guardrails block edge cases.

### Phase 3 — Polish + Mobile Hardening (T3)

**Scope:** Smart defaults, odds format toggle, mobile UX refinement, review card, cascade reset behavior.

**Deliverables:**
- Odds format toggle (American ↔ Decimal) with live conversion display
- Cascade reset (sport change resets downstream selections)
- Review card live update behavior
- Mobile input modes (`inputmode` attributes)
- Manual override escape hatch for governed fields
- Additional edge-case tests

**Test target:** Defaults, odds conversion, cascade reset, manual override flagging.

### Phase 4 — Reference Data API (Future, T2)

**Scope:** Transition from static config to API-backed reference data.

**Deliverables:**
- `GET /api/reference-data/{entity}` endpoints
- Database-seeded reference tables
- `reference-data-client.ts` updated to fetch from API
- Form graceful degradation when API is unavailable

**Not included in V1 milestone.** Triggered when operator/sport/team count exceeds static config practicality.

## 11. Test Strategy

| Layer | What | How |
|-------|------|-----|
| Validation unit tests | Every market type × required field, numeric guardrails, reference-data enforcement | `validation.test.ts` |
| Mapping unit tests | Every market type → correct SubmissionPayload, ticket type in metadata | `payload-mapping.test.ts` |
| Reference-data tests | Sport-filtering, governed select validation, degradation behavior | `validation.test.ts` + `reference-data-client.test.ts` |
| Integration tests | POST /submit → validation → API call → response | `server.test.ts` |
| Regression | Existing submit flow still works | Existing `server.test.ts` cases |

## 12. Unresolved Design Decisions

### 12a. Player name: free text vs search-select

Player is currently free text. It could be a search-select backed by the `participants` table, but:
- `participants` is not pre-seeded with canonical player data
- Player name matching is fuzzy (nicknames, abbreviations)
- V1 keeps free text for player name

**Decision**: Free text for V1. Search-select when `participants` has reliable seed data.

### 12b. Matchup: free text vs structured

Matchup is currently free text (e.g., "Knicks vs Heat"). It could be structured as two team selects.

**Decision**: Free text for V1. Structured matchup when game schedule data is available.

### 12c. Odds format conversion precision

Decimal → American conversion uses rounding. Edge case: 1.91 → -110 (exact), but 1.92 → -109 (rounding variance).

**Decision**: Round to nearest integer for American conversion. Display both formats in review card so operator can verify.

### 12d. Reference data staleness

Static config reference data has no TTL or freshness mechanism.

**Decision**: Acceptable for V1 (small, stable operator set). Transition to API-backed reference data (Phase 4) adds freshness guarantees.
