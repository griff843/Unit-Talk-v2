# CC Pick Detail Page Spec

**Issue:** UTV2-421
**Date:** 2026-04-07
**Authority:** This document specifies the unified pick detail page for the Command Center. It is derived from reading `CC_SCORING_CONTRACT.md`, `CC_OPERATIONS_WORKSPACE_MAP.md`, and `CC_IA_RATIFICATION.md` directly. No DB schema is invented — all fields come from existing tables as documented in CLAUDE.md and the audit.
**Merge tier:** T2 — doc, no runtime change.

---

## Purpose

The pick detail page answers four questions across the four workspaces. It is the single authoritative view of a pick's full lifecycle: from what the play is, to how the engine scored it, to where it routed and what happened, to what can be learned from the outcome.

**The page is entirely read-only.** Write actions (approve, deny, hold, retry, rerun, settle, correct) remain in the Operations workspace and are accessed via existing server actions. The pick detail page may surface links to those actions from the Operations section but does not implement new write paths.

---

## Four Questions the Page Answers

| Question | Section | Workspace origin |
|---|---|---|
| What is this play? | Research section | Research workspace context |
| Why did it score how it did? | Decision section | Decision workspace — see `CC_SCORING_CONTRACT.md` |
| Where did it route and what happened? | Operations section | Operations workspace — see `CC_OPERATIONS_WORKSPACE_MAP.md` |
| What can be learned? | Intelligence section | Intelligence workspace |

---

## Page Layout

The page is organized as four sections rendered sequentially top-to-bottom (or as tabs on narrower viewports). Each section answers exactly one of the four questions.

```
┌─────────────────────────────────────────┐
│  Pick Detail — [pick ID]                │
│  [Status badge]  [Submission source]    │
├─────────────────────────────────────────┤
│  1. RESEARCH — What is this play?       │
├─────────────────────────────────────────┤
│  2. DECISION — Why did it score?        │
├─────────────────────────────────────────┤
│  3. OPERATIONS — What happened?         │
├─────────────────────────────────────────┤
│  4. INTELLIGENCE — What can be learned? │
└─────────────────────────────────────────┘
```

**Page header:** Pick ID, current lifecycle status badge (`validated` / `queued` / `posted` / `settled` / `voided`), submission source. No workspace label in the header — the page spans all four workspaces.

---

## Section 1 — Research: What is this play?

**Question answered:** What player, stat, line, and matchup context define this pick?

### 1.1 Fields and Data Sources

All fields in this section come from the `picks` table (stored as the `CanonicalPick` payload) and supporting reference tables.

| Field | Display label | DB source | Notes |
|---|---|---|---|
| `picks.player_name` | Player | `picks` | |
| `picks.team` | Team | `picks` | |
| `picks.opponent` | Opponent | `picks` | |
| `picks.sport` | Sport | `picks` | |
| `picks.league` | League | `picks` | |
| `picks.event_name` | Game / Event | `picks` | Game identifier as submitted |
| `picks.game_date` | Game Date | `picks` | ISO date |
| `picks.market_type` | Market Type | `picks` | e.g. `player_prop_points`, `spread`, `total` |
| `picks.selection` | Selection | `picks` | e.g. `Over 24.5 Points` |
| `picks.line` | Line | `picks` | Numeric prop line or spread |
| `picks.odds` | Odds (submitted) | `picks` | American odds at submission time |
| `picks.confidence` | Confidence | `picks` | Submitter's self-reported confidence (0–1 range) |
| `picks.notes` | Notes | `picks` | Operator-supplied context note at submission |
| `picks.submitted_by` | Submitted by | `picks` | Capper identifier |
| `picks.source` | Source | `picks` | e.g. `smart-form`, `api`, `operator` |
| `picks.created_at` | Submitted at | `picks` | ISO timestamp |

### 1.2 Matchup Context (supplemental — when available)

When `picks.event_name` or `picks.game_date` can be matched to a live `events` row, the following additional context is shown. This is supplemental — the section must render even when no event row is found.

| Field | Display label | DB source | Fallback |
|---|---|---|---|
| `events.start_time` | Tip/puck/pitch time | `events` | `—` |
| `events.status` | Game status | `events` | `—` |
| `teams.name` (home/away) | Home / Away | `event_participants` + `teams` | `—` |

### 1.3 Fallback Rules

- Any field that is null or missing: show `—`
- If the entire `picks` row cannot be loaded: show "Pick not found — record may have been voided or purged"
- Do not show placeholder or loading values — only `—` or an explicit error message

---

## Section 2 — Decision: Why did it score how it did?

**Question answered:** What promotion scores did this pick receive, why was it qualified or suppressed, and what policy evaluated it?

This section is governed by `CC_SCORING_CONTRACT.md`. All label names, display formats, and fallback rules in that contract apply here without exception.

### 2.1 Fields and Data Sources

All fields in this section come from `pick_promotion_history` and `picks`.

| Field | Display label | DB source | Notes |
|---|---|---|---|
| `pick_promotion_history.edge` | Edge | `pick_promotion_history` | Raw component score 0–100 |
| `pick_promotion_history.trust` | Trust | `pick_promotion_history` | Raw component score 0–100 |
| `pick_promotion_history.readiness` | Readiness | `pick_promotion_history` | Raw component score 0–100 |
| `pick_promotion_history.uniqueness` | Uniqueness | `pick_promotion_history` | Raw component score 0–100 |
| `pick_promotion_history.board_fit` | Board Fit | `pick_promotion_history` | Raw component score 0–100 |
| `pick_promotion_history.promotion_score` | Promotion Score | `pick_promotion_history` | Composite score 0–100 (one decimal) |
| `pick_promotion_history.promotion_status` | Outcome | `pick_promotion_history` | Outcome badge — see contract Section 4 |
| `pick_promotion_history.promotion_target` | Policy evaluated for | `pick_promotion_history` | e.g. `best-bets`, `trader-insights` |
| `pick_promotion_history.decided_at` | Evaluated at | `pick_promotion_history` | ISO timestamp |
| `pick_promotion_history.decided_by` | Evaluated by | `pick_promotion_history` | e.g. `system`, `operator` |
| `payload.scoringProfile` | Scoring profile | `pick_promotion_history.payload` | Profile name from the stored snapshot |
| `payload.policyVersion` | Policy version | `pick_promotion_history.payload` | e.g. `best-bets-v2` |
| `payload.explanation.suppressionReasons` | Suppression reasons | `pick_promotion_history.payload` | Collapsed list; only shown when suppression reasons exist |
| `picks.approval_status` | Approval status | `picks` | Operator review decision — separate from promotion outcome |

### 2.2 Score Breakdown Table

Render the five components as a table per `CC_SCORING_CONTRACT.md` Section 3.2:

```
Component    | Score (0–100) | Weight | Weighted score
Edge         | 80            | 35%    | 28.0
Trust        | 65            | 25%    | 16.3
Readiness    | 72            | 20%    | 14.4
Uniqueness   | 50            | 10%    | 5.0
Board Fit    | 75            | 10%    | 7.5
─────────────────────────────────────────────────
Promotion Score: 71.2   Threshold: 70   Outcome: Qualified
```

### 2.3 Multiple Policy Evaluations

A pick may have multiple rows in `pick_promotion_history` (one per policy evaluated). Show each policy evaluation as a separate accordion or tab within the Decision section. Order them by priority: `exclusive-insights` first, then `trader-insights`, then `best-bets`.

When multiple evaluations exist, the resolved promotion target (`picks.promotion_target`) must be shown prominently as the final routing decision.

### 2.4 Approval vs Qualification Separation

**Required UI separation:** Approval status and promotion outcome must appear in visually distinct areas. They must never be combined into a single status indicator.

- Approval (`picks.approval_status`): show as a labeled field "Approval status" with values `approved` / `denied` / `hold` / `pending`
- Promotion outcome (`pick_promotion_history.promotion_status`): show as the outcome badge per contract

Do not use the approval status to imply promotion qualification or vice versa. Follow the language rules in `CC_SCORING_CONTRACT.md` Section 5 and the language constraints in `CC_IA_RATIFICATION.md` Section 2.2.

### 2.5 Fallback Rules

- Missing `pick_promotion_history` row: show "No promotion evaluation on record — this pick has not been evaluated by the promotion engine"
- Missing individual component score: show `—` per contract Section 6
- Missing suppression reasons: show nothing (no empty collapsible)
- Missing policy version: show `—`

---

## Section 3 — Operations: Where did it route and what happened?

**Question answered:** What is the pick's lifecycle state, where did it route in the delivery pipeline, what happened to the outbox row, and what operator actions were taken?

### 3.1 Lifecycle State

| Field | Display label | DB source | Notes |
|---|---|---|---|
| `picks.status` | Lifecycle state | `picks` | Values: `validated`, `queued`, `posted`, `settled`, `voided` |
| `picks.promotion_target` | Promotion target | `picks` | Channel the pick was routed to; `—` if no target |
| `picks.updated_at` | Last updated | `picks` | ISO timestamp |

**Lifecycle state badge mapping:**
- `validated` → "Validated — awaiting promotion or review"
- `queued` → "Queued — delivery pending"
- `posted` → "Posted — delivered to channel"
- `settled` → "Settled"
- `voided` → "Voided — will not route"

### 3.2 Lifecycle Event Log

Source: `pick_lifecycle` table (NOT `pick_lifecycle_events`).

Show all lifecycle transition events for this pick in chronological order.

| Field | Display label | DB source |
|---|---|---|
| `pick_lifecycle.from_state` | From | `pick_lifecycle` |
| `pick_lifecycle.to_state` | To | `pick_lifecycle` |
| `pick_lifecycle.actor` | Actor | `pick_lifecycle` |
| `pick_lifecycle.reason` | Reason | `pick_lifecycle` |
| `pick_lifecycle.created_at` | At | `pick_lifecycle` |

Render as a timeline or ordered list. If no `pick_lifecycle` rows exist for this pick, show "No lifecycle transitions recorded."

### 3.3 Outbox State

Source: `distribution_outbox`.

If one or more `distribution_outbox` rows exist for this pick, show each row.

| Field | Display label | DB source | Notes |
|---|---|---|---|
| `distribution_outbox.target` | Delivery target | `distribution_outbox` | e.g. `discord:best-bets` |
| `distribution_outbox.claim_state` | Outbox state | `distribution_outbox` | Values: `pending`, `claimed`, `done`, `failed`, `dead_letter` |
| `distribution_outbox.claimed_at` | Claimed at | `distribution_outbox` | ISO timestamp; `—` if not yet claimed |
| `distribution_outbox.created_at` | Enqueued at | `distribution_outbox` | ISO timestamp |

**Outbox state display rules:**
- `pending` → "Pending — awaiting worker claim"
- `claimed` → "Claimed — delivery in progress"
- `done` → "Done — delivery confirmed"
- `failed` → "Failed — delivery attempt failed; retryable"
- `dead_letter` → "Delivery failed — manual intervention required" (and link to Operations > Exceptions)

If no outbox row exists and the pick is in `queued` or `posted` state, show "Outbox record not found — data may be incomplete."
If no outbox row exists and the pick is in `validated` state, show nothing (pick has not been enqueued yet).

### 3.4 Delivery Receipts

Source: `distribution_receipts`.

If one or more `distribution_receipts` rows exist for this pick, show each confirmed delivery.

| Field | Display label | DB source |
|---|---|---|
| `distribution_receipts.target` | Delivered to | `distribution_receipts` |
| `distribution_receipts.delivered_at` | Delivered at | `distribution_receipts` |
| `distribution_receipts.external_id` | External message ID | `distribution_receipts` |

If no receipt rows exist and the pick is `posted` or `settled`, show "No delivery receipt on record."

### 3.5 Operator Actions (Audit Log)

Source: `audit_log` filtered to rows where `audit_log.entity_ref = pick.id` (as text).

**Schema note:** `audit_log.entity_id` is a FK to the primary entity (promotion history row, outbox row, settlement record) — not the pick ID. `audit_log.entity_ref` is the pick ID as text. Use `entity_ref` to filter.

Show operator actions in chronological order.

| Field | Display label | DB source |
|---|---|---|
| `audit_log.action` | Action | `audit_log` |
| `audit_log.actor` | Actor | `audit_log` |
| `audit_log.reason` | Reason | `audit_log` |
| `audit_log.created_at` | At | `audit_log` |

If no audit log rows exist for this pick, show "No operator actions recorded."

### 3.6 Write Action Links (Operations Workspace Only)

The Operations section of the pick detail page may surface links or buttons to the following existing write actions. These link to the existing server actions in `apps/command-center/src/app/actions/` — no new write paths are introduced.

| Action | Available when | Server action |
|---|---|---|
| Retry delivery | Outbox state is `failed` | `retryDelivery` in `intervention.ts` |
| Rerun promotion | Pick is `validated` | `rerunPromotion` in `intervention.ts` |
| Override promotion (force/suppress) | Operator has override authority | `overridePromotion` in `intervention.ts` |
| Requeue delivery | Pick is `posted` or outbox is `dead_letter` | `requeueDelivery` in `intervention.ts` |
| Approve / Deny / Hold / Return | Pick is pending review | `review.ts` actions |
| Settle manually | Pick is `posted` | `settle.ts` actions |
| Submit correction | Pick is `settled` | `settle.ts` correction action |

**Write action rules:**
- Only show actions that are valid for the pick's current lifecycle state (use `getAllowedActions(status)` from `lib/pick-actions.ts`)
- No new write actions may be added to the pick detail page that are not already implemented in the server actions listed above
- The page must not expose any new write paths to Supabase

### 3.7 Fallback Rules

- `picks.status` missing: show "—" for lifecycle state; do not default to any state
- Missing outbox row when expected: show explicit message per Section 3.3 rules
- Missing audit log: show "No operator actions recorded"
- Missing receipt when expected: show explicit message per Section 3.4 rules

---

## Section 4 — Intelligence: What can be learned?

**Question answered:** What was the outcome, how did it compare to the market close, and what does this tell us about the model?

### 4.1 Settlement Outcome

Source: `settlement_records`.

| Field | Display label | DB source | Notes |
|---|---|---|---|
| `settlement_records.result` | Result | `settlement_records` | `win` / `loss` / `push` / `void` |
| `settlement_records.settled_at` | Settled at | `settlement_records` | ISO timestamp |
| `settlement_records.actual_value` | Actual stat value | `settlement_records` | The stat result that determined the outcome |
| `settlement_records.settlement_source` | Settlement source | `settlement_records` | e.g. `automated`, `manual`, `operator` |
| `settlement_records.corrects_id` | Correction of | `settlement_records` | If present, this row corrects a prior settlement; show link to original row. Original row is never mutated. |

**Important:** `settlement_records.corrects_id` is a self-referencing FK. If non-null, label this row "Correction" and show a link to the original settlement row. The original row must never be modified.

If the pick is not yet settled, show "Not yet settled — outcome pending."

### 4.2 CLV Delta (when available)

Source: `settlement_records.clv_at_close` and `picks.odds`.

Closing line value measures how much the submitted odds moved in the pick's favor by close. A positive CLV delta means the market moved to agree with the pick — the line got worse to bet after submission.

| Field | Display label | DB source | Notes |
|---|---|---|---|
| `picks.odds` | Submitted odds | `picks` | American odds at submission |
| `settlement_records.clv_at_close` | Closing line value | `settlement_records` | CLV at market close; null if not computed |
| CLV delta (derived) | CLV delta | Computed from `picks.odds` and `clv_at_close` | Derived field — not stored separately |

**CLV display rules:**
- Show CLV delta as a signed number (e.g., `+3.2` or `-1.8`) with the label "CLV delta"
- Label the closing line value field "Closing line value (at close)"
- If `clv_at_close` is null: show `—` for both CLV fields with the note "CLV not yet computed for this pick"
- Do not attempt to compute or estimate CLV from other fields — show `—` if the DB value is missing

### 4.3 Model Feedback Note

Source: `pick_promotion_history.payload` (for score inputs) and `settlement_records.result` (for outcome).

When both promotion scores and a settlement outcome exist, the Intelligence section may surface a brief model feedback note that cross-references the promotion score tier with the actual outcome. This is informational only — it is not a model update or calibration trigger.

| Display condition | Note to show |
|---|---|
| `promotion_score >= 85` and `result = 'win'` | "High-confidence pick — outcome aligned with score tier" |
| `promotion_score >= 85` and `result = 'loss'` | "High-confidence pick — outcome did not align; review for model calibration" |
| `promotion_score < 70` and pick was force-promoted and `result = 'win'` | "Operator force-promoted pick — outcome was positive despite score below threshold" |
| `promotion_score < 70` and pick was force-promoted and `result = 'loss'` | "Operator force-promoted pick — outcome aligned with engine suppression signal" |
| Any other combination | No note shown |

**Model feedback note rules:**
- Notes are advisory only — they do not trigger any DB write
- Notes must not claim causation ("the model was right/wrong") — only correlation
- Notes must not appear if either score or outcome is missing

### 4.4 Fallback Rules

- No `settlement_records` row and pick is not `settled`: show "Outcome pending — pick has not been settled"
- No `settlement_records` row and pick is `settled`: show "Settlement record missing — pick status is settled but no settlement record found"
- `clv_at_close` is null: show `—` for CLV fields per Section 4.2
- No model feedback note condition is met: show nothing (do not render the note block)

---

## Section 5 — Read-Only Enforcement

**Every section on this page is read-only except for the action links in Section 3.6.**

| Rule | Applies to |
|---|---|
| No inline editing of pick fields | Research section |
| No score adjustment controls | Decision section |
| Write actions only via existing server actions | Operations section |
| No ability to trigger a new settlement or CLV recompute | Intelligence section |

**No new DB columns are required by this spec.** All fields listed in this document exist in the current schema as documented in CLAUDE.md and the audit documents.

---

## Section 6 — Data Source Summary

| Section | DB tables | API endpoint |
|---|---|---|
| Research | `picks`, `events`, `event_participants`, `teams` | `GET /api/operator/picks/:id` |
| Decision | `picks`, `pick_promotion_history` | `GET /api/operator/picks/:id` |
| Operations | `picks`, `pick_lifecycle`, `distribution_outbox`, `distribution_receipts`, `audit_log` | `GET /api/operator/picks/:id` |
| Intelligence | `settlement_records`, `picks`, `pick_promotion_history` | `GET /api/operator/picks/:id` |

The existing `GET /api/operator/picks/:id` endpoint (`handlePickDetailRequest`) already returns pick, lifecycle, promotion history, outbox rows, receipts, settlements, and audit trail. No new operator-web endpoint is required for the base spec. The endpoint may need to be confirmed as returning all fields listed — this is an implementation-time verification, not a new contract.

---

## Section 7 — Missing Data and Fail-Closed Behavior

This spec enforces fail-closed display throughout. The following rules apply globally to every section:

| Condition | Required display |
|---|---|
| Any field value is null, undefined, or missing | Show `—` (em dash) |
| Any DB row is missing when expected | Show explicit "not found" or "not yet recorded" message (see per-section rules) |
| `picks` row cannot be loaded | Show "Pick not found — record may have been voided or purged"; render no other sections |
| Component score is NaN or non-finite | Show `—` per `CC_SCORING_CONTRACT.md` Section 6 |
| Any score value is 0 | Show `0` — zero is a valid score, not a missing value |
| Settlement record is missing and pick is `settled` | Show explicit missing-record warning — do not infer outcome |

**Never fabricate values.** Never show a default that could be mistaken for real data. The only acceptable fallback is `—` or an explicit "not recorded" / "not found" message.
