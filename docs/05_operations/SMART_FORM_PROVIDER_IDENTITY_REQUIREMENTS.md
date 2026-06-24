# Smart Form — Canonical Provider Market Identity Requirements (UTV2-1269)

**Status:** Requirements / planning only. **Tier:** T2. **Lane:** UTV2-1269.
**Scope boundary:** This document defines *what* Smart Form must capture and enforce. It does **not** implement UI, schema, or scoring changes — any implementation requires a separate PM-approved lane. No CLV/ROI/edge claims are made here.

## 1. Problem

A pick can today enter the evidence/scoring path without exact provider market identity, or with a stale / alt / intermediate line treated as the true close. Both produce unsound downstream CLV and grading. Smart Form must become the **front-door fail-closed guardrail**: a pick cannot become evidence-eligible unless its provider market identity is exact and provider-truth-validated at entry.

This complements (does not duplicate) the SGO native-close-evidence capture work and the forward-flow CLV monitor; it is the intake-side contract those rely on.

## 2. Required intake fields

Every Smart Form submission that intends to be evidence-eligible MUST carry the following. Fields are grouped by role; "required" means evidence-eligibility is blocked fail-closed if absent (see §4).

### 2.1 Provider identity (required, fail-closed)
| Field | Meaning | Source of truth |
|---|---|---|
| `provider_event_id` | SGO event identifier | SGO event feed |
| `provider_market_key` | canonical provider market key | SGO odds / normalizer |
| `provider_participant_id` | SGO participant (player/team) id; null only for genuine team/game-line markets | SGO participants |
| `sgo_odd_id` (`oddID`) | exact SGO oddID for the selection | SGO odds |
| `stat_id` (`statID`) | SGO stat identifier | SGO odds |
| `stat_entity_id` (`statEntityID`) | SGO stat entity (who/what the stat is about) | SGO odds |
| `period_id` (`periodID`) | period scope (full game, 1H, 1ix3, etc.) | SGO odds |
| `bet_type_id` (`betTypeID`) | bet type (ou / ml / sp / ml3way …) | SGO odds |
| `side_id` (`sideID`) | over/under/home/away/etc. | SGO odds |
| `bookmaker` | bookmaker key the line is sourced from | SGO byBookmaker / provider |

### 2.2 Entry economics (required)
| Field | Meaning |
|---|---|
| `line_at_entry` | the line the user is acting on, captured at submit |
| `odds_at_entry` | the odds at submit |

### 2.3 Line classification (required)
| Field | Meaning |
|---|---|
| `is_alt_line` | true if this is an alternate (non-main) line |
| `is_main_line` | true if this is the provider's main line |
| `market_eligibility` | derived eligibility class (evidence-eligible / CLV-ineligible / blocked) |
| `provider_truth_status_at_entry` | provider-truth validation outcome captured at entry (see §4) |

## 3. Provider-truth validation at entry

At submit, Smart Form resolves the submission against provider truth and records `provider_truth_status_at_entry` ∈ { `validated`, `warn`, `blocked` }. The resolution must verify the selection matches a real provider offer on **all** identity axes:

- same event (`provider_event_id`)
- same player/team (`provider_participant_id` / `stat_entity_id`)
- same market/stat (`provider_market_key` / `stat_id`)
- same line (`line_at_entry` vs provider line, within the alt/main rules of §4)
- same side (`side_id`)
- same period (`period_id`)
- a valid over/under (or paired) market with a **healthy overround**

## 4. Validation behavior (fail-closed)

| Condition | Behavior |
|---|---|
| wrong player (participant mismatch) | **warn or block** — block when evidence-eligibility is claimed |
| wrong event | **warn or block** — block when evidence-eligibility is claimed |
| wrong market / stat | **warn or block** — block when evidence-eligibility is claimed |
| stale line (entry line older than freshness threshold) | **warn or block depending on severity**; never silently treated as the true close |
| alt-line | **allowed only if explicitly accepted and tracked separately** (`is_alt_line=true`, segregated from main-line evidence) |
| 1H / no-close market | **CLV-ineligible** unless provider truth explicitly supports a close for that market |
| impossible overround | **block evidence eligibility** |
| missing any §2.1 SGO provider identity field | **block evidence eligibility** (fail-closed — no silent pass) |
| line moved between entry and provider validation | **persist both** the entry state and the current provider state; do not overwrite entry with the moved line |

Fail-closed default: if provider truth cannot be resolved at entry, the pick is **not** evidence-eligible. No silent fallback to eligible.

## 5. Persistence contract (requirements, not schema)

- Entry state and provider-validated state are **both** retained (no destructive overwrite when the line moves).
- `provider_truth_status_at_entry` is immutable once written.
- Alt-line evidence is segregated from main-line evidence so downstream CLV/grading never conflates them.
- These are persistence *requirements*; the actual columns/tables are a separate PM-approved migration lane.

## 6. Out of scope (explicit)

- No UI implementation. No DB schema/migration. No scoring/promotion/CLV computation changes. No Discord changes. No marking UTV2-1042 Done. No CLV/ROI/edge claims.

## 7. Dependencies

- SGO native close-evidence capture (closing book/fair odds) — the close-side counterpart to this intake contract.
- Forward-flow CLV-path settlement sample monitor — consumes evidence produced under this contract; its results inform thresholds here.
- SGO provider knowledge base (oddID/statID/period/betType/side semantics).

## 8. Acceptance (for this requirements lane)

This lane is complete when: the required fields (§2), provider-truth validation axes (§3), fail-closed validation behavior (§4), and persistence requirements (§5) are documented and ratified as the intake contract — with no implementation performed.
