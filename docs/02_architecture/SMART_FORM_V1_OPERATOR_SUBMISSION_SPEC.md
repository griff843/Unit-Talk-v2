# Smart Form V1 — Operator Submission Surface Spec

> **Contract**: `docs/05_operations/SMART_FORM_V1_OPERATOR_SUBMISSION_CONTRACT.md`
> **Sprint model**: `docs/05_operations/SPRINT_MODEL_v2.md`

## 1. Technology

Smart Form V1 is built as a server-rendered HTML surface on the existing `apps/smart-form` Node.js HTTP server. No frontend framework. No build toolchain beyond TypeScript. The form is embedded as template functions in TypeScript source files.

This matches the existing pattern in V2 (operator-web and current smart-form both use this approach).

## 2. Form Structure

### Section 1 — Ticket Basics

| Field | Control | Default | Required | Validation |
|-------|---------|---------|----------|------------|
| Capper | text input | — | Hard | Non-empty |
| Date | date input | Today | Hard | Valid date |
| Sport | text input or select | — | Hard | Non-empty |
| Sportsbook | text input | — | Warn | Warn if empty |
| Units | number input (step 0.5) | 1.0 | Hard | 0.5 ≤ x ≤ 5.0 |
| Odds Format | segmented: American / Decimal | American | Hard | — |
| Odds | number input | — | Hard | Non-zero finite number |
| Confidence | number input (step 0.01) | — | Optional | 0 < x < 1 if provided |

### Section 2 — Market Type

Segmented control with five options:
- **Player Prop**
- **Moneyline**
- **Spread**
- **Total**
- **Team Total**

Selecting a market type reveals only the relevant fields in Section 3.

### Section 3 — Bet Details (dynamic)

#### Player Prop

| Field | Control | Required | Validation |
|-------|---------|----------|------------|
| Player | text input | Hard | Non-empty |
| Matchup | text input | Hard | Non-empty (e.g., "Knicks vs Heat") |
| Stat Type | text input or select | Hard | Non-empty (e.g., "Points", "Rebounds") |
| Over / Under | segmented: Over / Under | Hard | Must select one |
| Line | number input (step 0.5) | Hard | Finite number |

**Constructed fields:**
- `market` = `"{Sport} {StatType}"` (e.g., "NBA Points")
- `selection` = `"{Player} {Over/Under} {Line}"` (e.g., "Jalen Brunson Over 24.5")

#### Moneyline

| Field | Control | Required | Validation |
|-------|---------|----------|------------|
| Matchup | text input | Hard | Non-empty |
| Team / Side | text input | Hard | Non-empty |

**Constructed fields:**
- `market` = `"{Sport} Moneyline"`
- `selection` = `"{Team}"` (e.g., "Knicks")

#### Spread

| Field | Control | Required | Validation |
|-------|---------|----------|------------|
| Matchup | text input | Hard | Non-empty |
| Team / Side | text input | Hard | Non-empty |
| Line | number input (step 0.5) | Hard | Finite number (e.g., -3.5, +7) |

**Constructed fields:**
- `market` = `"{Sport} Spread"`
- `selection` = `"{Team} {Line}"` (e.g., "Knicks -3.5")

#### Total

| Field | Control | Required | Validation |
|-------|---------|----------|------------|
| Matchup | text input | Hard | Non-empty |
| Over / Under | segmented: Over / Under | Hard | Must select one |
| Line | number input (step 0.5) | Hard | Finite number |

**Constructed fields:**
- `market` = `"{Sport} Total"`
- `selection` = `"{Over/Under} {Line}"` (e.g., "Over 215.5")

#### Team Total

| Field | Control | Required | Validation |
|-------|---------|----------|------------|
| Matchup | text input | Hard | Non-empty |
| Team | text input | Hard | Non-empty |
| Over / Under | segmented: Over / Under | Hard | Must select one |
| Line | number input (step 0.5) | Hard | Finite number |

**Constructed fields:**
- `market` = `"{Sport} Team Total"`
- `selection` = `"{Team} {Over/Under} {Line}"` (e.g., "Knicks Over 108.5")

### Section 4 — Review Card

Compact bet-slip-style summary rendered inline before the submit button:

```
┌─────────────────────────────────┐
│  Capper: griff843               │
│  Sport: NBA                     │
│  Market: NBA Points             │
│  Pick: Jalen Brunson Over 24.5  │
│  Line: 24.5                     │
│  Odds: -110                     │
│  Units: 1.5                     │
│                                 │
│  ✓ All required fields present  │
│  ⚠ Sportsbook not provided     │
│  ✓ Odds valid for enrichment    │
└─────────────────────────────────┘

       [ Submit Pick ]
```

The review card updates as the user fills fields. Blocking errors show inline. Warnings show as amber.

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

## 3. Mobile UX Rules

- **Layout**: Single column, max-width 480px centered, full-width on small screens
- **Tap targets**: Minimum 44px height for all interactive elements
- **Segmented controls**: Full-width tap bars for Market Type, Over/Under, Odds Format
- **Numeric inputs**: Use `inputmode="decimal"` or `inputmode="numeric"` to trigger mobile number keyboard
- **Progressive reveal**: Section 3 fields appear only after market type is selected
- **Scroll behavior**: On validation failure, scroll to first error field
- **No horizontal scroll**: All content fits within viewport width

## 4. Validation Engine

### Client-Side (Smart Form Server)

Validation runs on `POST /submit` before calling the API. The validation function takes the parsed form body and market type, returns an array of field-level errors.

```typescript
interface FieldError {
  field: string;        // e.g., "player", "odds", "units"
  message: string;      // e.g., "Player is required for player prop markets"
  severity: 'error' | 'warning';
}

function validateSmartFormSubmission(
  form: ParsedFormBody,
  marketType: MarketType,
): FieldError[]
```

**Error severity:**
- `error` → blocks submit, shown in red
- `warning` → allows submit, shown in amber

### Server-Side (API)

The existing API validation (`validateSubmissionPayload`) remains unchanged. It validates `source`, `market`, `selection` are non-empty. The smart form's richer validation runs before the API call, so the API acts as a safety net, not the primary validator.

## 5. Payload Mapping

```typescript
function mapSmartFormToSubmissionPayload(form: ParsedFormBody): SubmissionPayload {
  const market = constructMarket(form.sport, form.marketType, form.statType);
  const selection = constructSelection(form);

  return {
    source: 'smart-form',
    submittedBy: form.capper,
    market,
    selection,
    line: form.line,
    odds: normalizeOdds(form.odds, form.oddsFormat),
    stakeUnits: form.units,
    confidence: form.confidence,
    eventName: form.matchup,
    metadata: {
      capper: form.capper,
      sport: form.sport,
      date: form.date,
      marketType: form.marketType,
      sportsbook: form.sportsbook,
      ...(form.player ? { player: form.player } : {}),
      ...(form.statType ? { statType: form.statType } : {}),
      ...(form.overUnder ? { overUnder: form.overUnder } : {}),
      ...(form.team ? { team: form.team } : {}),
      eventName: form.matchup,
    },
  };
}
```

**Odds normalization:**
- If odds format is American: pass through as-is
- If odds format is Decimal: convert to American before submission (the API and enrichment pipeline expect American odds)

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

## 6. File Structure

```
apps/smart-form/src/
├── index.ts                    # Entry point (no change)
├── server.ts                   # Routing + form rendering (rewrite)
├── server.test.ts              # Tests (rewrite + extend)
├── validation.ts               # NEW: validation engine
├── validation.test.ts          # NEW: validation tests
├── payload-mapping.ts          # NEW: form → SubmissionPayload mapping
├── payload-mapping.test.ts     # NEW: mapping tests
└── form-templates.ts           # NEW: HTML template functions
```

**Why separate files:**
- `server.ts` is currently 500+ lines with form HTML embedded. Splitting into `form-templates.ts` (HTML), `validation.ts` (rules), and `payload-mapping.ts` (mapping) keeps each file focused.
- Test files mirror source files for clear coverage.

## 7. Build Plan

### Phase 1 — Form Surface + Validation (T2)

**Scope:** New form UI with market-type-aware fields, validation engine, bet-slip layout.

**Deliverables:**
- `form-templates.ts` — mobile-first HTML templates with progressive reveal
- `validation.ts` — field-level validation per market type
- `validation.test.ts` — unit tests for all 5 market types × required fields
- `server.ts` — updated routing to render new form, handle validation
- `server.test.ts` — updated integration tests

**Not included:** API integration (submit renders static success mock).

**Test target:** Validation rules for all 5 market types proven correct.

### Phase 2 — Submit Integration + Enrichment Display (T2)

**Scope:** Wire form submit to existing API, display enrichment results.

**Deliverables:**
- `payload-mapping.ts` — form fields → SubmissionPayload mapping
- `payload-mapping.test.ts` — mapping tests for all market types
- `server.ts` — real API integration, success/failure rendering with enrichment status
- Updated `server.test.ts` — end-to-end submit flow tests

**Test target:** Full submit flow through API, enrichment visibility, error display.

### Phase 3 — Polish + Mobile Hardening (T3)

**Scope:** Smart defaults, odds format toggle, mobile UX refinement, edge cases.

**Deliverables:**
- Smart defaults (date=today, units=1.0)
- Odds format toggle (American ↔ Decimal) with conversion
- Mobile input modes (`inputmode` attributes)
- Review card live update behavior
- Additional edge-case tests

**Test target:** Defaults, odds conversion, mobile input behavior.

## 8. Test Strategy

| Layer | What | How |
|-------|------|-----|
| Validation unit tests | Every market type × every required field | `validation.test.ts` — pure function tests |
| Mapping unit tests | Every market type → correct SubmissionPayload | `payload-mapping.test.ts` — pure function tests |
| Integration tests | POST /submit → validation → API call → response | `server.test.ts` — HTTP tests with mocked API |
| Regression | Existing submit flow still works | Existing `server.test.ts` cases preserved or migrated |

**Test count expectation:**
- Phase 1: ~20-30 new validation tests
- Phase 2: ~10-15 mapping + integration tests
- Phase 3: ~5-10 edge case tests
- Total: ~35-55 new tests across the milestone

## 9. Unresolved Design Decisions

### 9a. Sport field: free text vs select

**Options:**
1. Free text input — maximum flexibility, no maintenance
2. Select from known list (NBA, NFL, MLB, NHL, etc.) — faster entry, prevents typos

**Recommendation:** Start with a select of the 5-6 most common sports plus an "Other" option with free text fallback. Low effort, better UX, easy to extend.

### 9b. Odds format conversion direction

The API expects American odds. If the form supports decimal input:

**Question:** Should the form convert decimal → American client-side before submit, or should the API accept both formats?

**Recommendation:** Form converts to American before submit. No API changes needed. The conversion is a simple formula. Display both formats in the review card for operator confidence.

### 9c. Stat type: free text vs select

Player prop stat types (Points, Rebounds, Assists, etc.) could be a select or free text.

**Recommendation:** Same as sport — select from common list plus free text fallback. Per-sport stat type lists can be hardcoded initially and expanded.

## 10. Suggested First Implementation Sprint

### Sprint: SMART_FORM_V1_PHASE1_FORM_SURFACE

**Tier:** T2
**Objective:** Build the market-aware form surface with validation engine and mobile-first layout.

**Ordered tasks:**

1. Create `validation.ts` with `validateSmartFormSubmission()` — the pure validation function that takes parsed form body + market type and returns field errors. Cover all 5 market types and all required/conditional/warn rules.

2. Create `validation.test.ts` — unit tests for every market type × required field combination. Include edge cases: missing fields, out-of-range units, malformed odds, partial player prop identity.

3. Create `form-templates.ts` — HTML template functions for the new bet-slip-style form. Mobile-first layout, segmented controls for market type and over/under, progressive reveal of Section 3 based on market type selection. Use minimal inline JS for progressive reveal (show/hide sections based on market type radio/select).

4. Create `payload-mapping.ts` with `mapSmartFormToSubmissionPayload()` — the pure mapping function that constructs `market`, `selection`, and `metadata` from the rich form fields. Include `constructMarket()` and `constructSelection()` helpers.

5. Create `payload-mapping.test.ts` — unit tests for all 5 market type mappings.

6. Update `server.ts` — replace the old form render with the new templates, wire validation into the POST handler, render validation errors inline. Keep API submit call working (existing integration).

7. Update `server.test.ts` — migrate existing tests to new form shape, add integration tests for validation rejection and market-type-specific behavior.

8. Run `pnpm verify` — all gates must pass.

**Non-goals for this sprint:**
- Odds format toggle (Phase 3)
- Smart defaults beyond date=today (Phase 3)
- Review card live update (Phase 3)
- Lookup/autofill (future enhancement)
