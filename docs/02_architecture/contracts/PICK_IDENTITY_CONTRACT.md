# Pick Identity Contract — Operator Surfaces

**Status:** Ratified 2026-04-14 (UTV2-563)
**Authority:** Canonical display rules for pick identity on all Command Center operator surfaces.
**Scope:** `apps/operator-web` routes, any future operator-facing UI that renders pick data.

---

## Problem

The Command Center does not reliably tell a human operator what a pick actually is. Rows and detail views surface generic market archetypes or workflow metadata before betting truth. A row that says "player over" or "all game over/under" without entity context is not human-identifiable. Operators cannot safely approve, settle, or triage picks they cannot identify.

---

## Principle

**Betting truth leads. Internal metadata follows.**

Every pick rendered on an operator surface must answer the question "what is the wager?" before it surfaces any workflow, scoring, or system metadata. If an operator cannot identify the exact bet from the first line of a row or the hero of a detail view, the surface is non-compliant.

---

## 1. Required Identity Fields

Every operator surface that renders a pick must display the following fields. These fields constitute the **minimum human-identifiable pick identity**.

### Tier 1 — Always Required (must be visible without drill-down)

| Field | Source | Display Label | Example |
|---|---|---|---|
| **Sport / League** | `sport_id` FK or `metadata.sport` | Sport | NBA |
| **Event / Matchup** | `metadata.eventName` or derived from teams | Matchup | LAL @ BOS |
| **Selection** | `picks.selection` | Selection | LeBron James Over 25.5 Pts |
| **Market** | `picks.market` (normalized key) | Market | player_points_over_under |
| **Line** | `picks.line` | Line | 25.5 |
| **Odds** | `picks.odds` | Odds | -110 |
| **Source** | `picks.source` | Source | smart-form |
| **Lifecycle Status** | `picks.status` | Status | queued |

### Tier 2 — Required on Detail and Queue Surfaces

| Field | Source | Display Label |
|---|---|---|
| **Capper / Submitted By** | `capper_id` FK or `metadata.submittedBy` | Capper |
| **Event Start Time** | `metadata.eventStartTime` or `metadata.eventTime` | Event Time |
| **Approval Status** | `picks.approval_status` | Approval |
| **Stake Units** | `picks.stake_units` | Stake |
| **Confidence** | `picks.confidence` | Confidence |
| **Pick ID** | `picks.id` | Pick ID |
| **Created At** | `picks.created_at` | Submitted |

### Tier 3 — Required on Detail Surface Only

| Field | Source | Display Label |
|---|---|---|
| **Promotion Status** | `picks.promotion_status` | Promotion |
| **Promotion Target** | `picks.promotion_target` | Target |
| **Promotion Score** | `picks.promotion_score` | Score |
| **Settlement Result** | `settlement_records.result` | Result |
| **Settlement Date** | `picks.settled_at` | Settled |
| **Submission ID** | `picks.submission_id` | Submission |
| **Posted At** | `picks.posted_at` | Posted |

---

## 2. Display Hierarchy

Surfaces must render pick identity in this order. Higher items appear first (top of row, left of card, hero of detail).

### Queue / List Row (compact)

```
[Sport] [Matchup] — [Selection] @ [Line] ([Odds])
[Source] · [Capper] · [Status] · [Created]
```

**Example row:**
```
NBA  LAL @ BOS — LeBron James Over 25.5 Pts @ -110
smart-form · john_doe · awaiting_approval · 2026-04-14 09:30
```

### Pick Detail Hero (expanded)

```
[Selection] @ [Line] ([Odds])
[Sport] · [Matchup] · [Event Time]
[Source] · [Capper] · [Stake]u · [Confidence]%
[Status] · [Approval] · [Promotion Status]
```

The hero must answer "what is the bet?" in the first line. Status and workflow metadata appear below.

### Card (intermediate)

Cards follow the queue row layout with the addition of Tier 2 fields. The first line must always contain the wager identity (selection + line + odds), not workflow metadata.

---

## 3. Fallback Behavior

When identity fields are missing or null, surfaces must degrade gracefully — never silently omit or show raw nulls.

| Field | Fallback | Display |
|---|---|---|
| Sport / League | Unknown | `—` (em-dash) |
| Matchup / Event | Not available | `(no matchup)` |
| Selection | **Must never be null** | If null, render `MISSING SELECTION` in error styling |
| Market | Raw market key | Display the normalized `picks.market` value as-is |
| Line | Not applicable | Omit field entirely (some markets have no line) |
| Odds | Not available | `—` |
| Source | **Must never be null** | Schema enforces NOT NULL |
| Capper / Submitted By | Unknown submitter | `(unknown capper)` |
| Event Start Time | Not available | `—` |

### Critical Rule

If **both** matchup and selection are missing or generic, the surface must render a **warning badge** indicating the pick cannot be reliably identified. This prevents operators from acting on unidentifiable picks.

---

## 4. Naming Rules

### Matchup Format

- Team sports: `[AWAY] @ [HOME]` — always away-first, `@` separator
- If only one team is available: `[TEAM] vs TBD`
- If no teams: use `metadata.eventName` as-is

### Player Name Format

- Full name when available: `LeBron James`
- Last name only as fallback: `James`
- Never abbreviate to initials on operator surfaces

### Market Display

- Use human-readable label when market type is resolvable: `Player Points O/U`
- Fall back to normalized market key: `player_points_over_under`
- Never display raw provider market IDs

### Line and Odds

- Line: decimal with 1 digit precision (`25.5`, `3.0`, `-7.5`)
- Odds: American format with sign (`-110`, `+150`, `EVEN` for +-100)
- When odds are decimal internally, convert to American for display

### Source Display

- Use exact `PickSource` enum value: `smart-form`, `alert-agent`, `model-driven`, etc.
- May add a human-friendly label alongside: `smart-form (Manual)`
- Never abbreviate or omit source

### Timestamps

- Absolute format: `YYYY-MM-DD HH:MM` in operator's local timezone
- Relative format allowed as secondary: `(2h ago)`
- Never relative-only — operators need exact times for audit

---

## 5. Prohibited Patterns

The following patterns are non-compliant. Implementation must actively prevent them.

| Pattern | Why It's Prohibited |
|---|---|
| Row shows only `market` + `status` without selection or matchup | Operator cannot identify the bet |
| Generic label like "player over" without player name | Not human-identifiable |
| "all game over/under" without teams or event | Ambiguous — could be any game |
| Pick ID as primary identifier in row | UUIDs are not human-readable wager descriptions |
| Workflow metadata (promotion score, idempotency key) above betting identity | Violates display hierarchy |
| Raw `null` or blank cell for required Tier 1 fields | Must use fallback per section 3 |
| Internal column names as display labels (`stake_units`, `promotion_decided_at`) | Use human labels per section 1 |
| Settlement result without the pick identity alongside | Operators must see what was settled |

---

## 6. Surface Compliance Matrix

Implementation status per surface (to be filled by UTV2-564 audit):

| Surface | Route | Tier 1 Complete | Tier 2 Complete | Compliant |
|---|---|---|---|---|
| Review Queue | `/api/operator/review-queue` | TBD | TBD | TBD |
| Pick Search | `/api/operator/pick-search` | TBD | TBD | TBD |
| Pick Detail | `/api/operator/pick-detail/:id` | TBD | TBD | TBD |
| Board Queue | `/api/operator/board-queue` | TBD | TBD | TBD |
| Held Queue | `/api/operator/held-queue` | TBD | TBD | TBD |
| Exception Queues | `/api/operator/exception-queues` | TBD | TBD | TBD |
| Picks Pipeline | `/api/operator/picks-pipeline` | TBD | TBD | TBD |

---

## 7. Data Availability Notes

Fields needed for identity that are **not top-level columns** on `picks`:

| Field | Current Location | Action Needed |
|---|---|---|
| `submittedBy` / capper | `metadata.submittedBy` or `capper_id` FK | Resolve at read time via FK join or metadata extract |
| `eventStartTime` | `metadata.eventStartTime` or `metadata.eventTime` | Extract from metadata at read time |
| `sport` | `sport_id` FK to `sports` table | Join at read time |
| `matchup` / event label | `metadata.eventName` | Extract from metadata; if absent, derive from team FKs if available |
| `player name` | `metadata` (varies by source) | Extract when market type is player prop |
| `team names` | Not reliably persisted | May require enrichment from external data or event context |

If the UTV2-564 audit finds that critical identity fields are missing upstream (not in metadata or FKs), those gaps must be addressed by write-path enrichment before CC surfaces can be compliant.

---

## 8. Implementation Sequence

1. **UTV2-563** (this document) — Ratify contract
2. **UTV2-564** — Audit existing surfaces against this contract; fill compliance matrix
3. **UTV2-565** — Render canonical identity on queue/list surfaces
4. **UTV2-566** — Rebuild pick detail hero per display hierarchy
5. **UTV2-567** — Simplify IA after legibility is solved
6. **UTV2-568** — Surface settlement and game-result truth

---

## Related Artifacts

- `packages/contracts/src/picks.ts` — `CanonicalPick` type
- `packages/contracts/src/submission.ts` — `SubmissionPayload` input schema
- `packages/db/src/database.types.ts` — `PickRow` (32 columns)
- `apps/operator-web/src/routes/` — All CC read paths
- `apps/api/src/submission-service.ts` — Pick creation and enrichment
