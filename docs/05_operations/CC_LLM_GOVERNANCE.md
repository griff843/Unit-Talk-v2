# Command Center LLM Analysis Governance Contract

**Issue:** UTV2-426
**Date:** 2026-04-07
**Status:** Ratified — governs all LLM integration in the Command Center
**Authority:** This document is the governing contract for any use of LLM-generated content in `apps/command-center`. No LLM integration work may proceed without this contract in place. This contract supersedes any ad-hoc LLM commentary added without explicit governance.

---

## Section 1 — Purpose and Scope

### 1.1 What This Governs

This document governs the role of LLM-generated content in the Command Center (CC). It defines:

- Which CC pages and sections may include LLM commentary
- What LLM may summarize or narrate
- What LLM may not invent, replace, or fabricate
- Fallback behavior when LLM is unavailable
- The circuit-breaker pattern required for all LLM dependencies

### 1.2 What This Does Not Govern

- LLM use in `apps/discord-bot`, `apps/api`, or any other app
- Member-facing content (operator-only CC surfaces are in scope)
- Model selection, prompt engineering, or infrastructure provisioning
- The Intelligence workspace's domain computation layer (`packages/domain/src/`) — that is pure deterministic code, not LLM

### 1.3 Core Principle

**LLM wraps real data. LLM never replaces real data.**

The Command Center is an operator tool grounded in canonical DB state. Every number, score, status, record, and metric displayed in CC must originate from the database via `apps/operator-web` API endpoints. LLM-generated text may add narrative context around that data. It may not substitute for it, override it, or be displayed in place of it when data is unavailable.

---

## Section 2 — Permitted LLM Use Cases

LLM commentary is permitted only in the forms listed below. Any form not listed is implicitly prohibited.

### 2.1 Narrative Wrapping

LLM may generate a short natural-language summary of data that has already been fetched and rendered. The rendered data is always the primary surface. The LLM summary is secondary and optional.

**Example (permitted):**
> "Diamond cappers produced a 12% flat-bet ROI over the last 30 days on 87 settled picks, outperforming Gold by 4.2 percentage points."

This narrates numbers that are already displayed in the ROI module. It does not introduce new numbers.

### 2.2 Score Component Commentary

In the Decision workspace Score Breakdown module, LLM may generate a plain-language explanation of why a pick received a given set of promotion scores. The explanation must be derived from the score values already returned by `pick_promotion_history` and the component definitions in `@unit-talk/contracts`.

The LLM commentary is rendered below the canonical score table. The canonical table is always rendered first, unconditionally.

**Example (permitted):**
> "This pick scored low on readiness (2.1/10) because it was submitted with less than 4 hours to game time. Edge scored well (7.8/10) reflecting a line above the Pinnacle fair odds threshold."

The scores cited in the commentary must match the scores in the canonical table. Commentary must not paraphrase or adjust scores.

### 2.3 Exception and Intervention Summaries

In the Operations workspace Exception panel and Intervention Log, LLM may generate a concise summary of the exception or intervention chain for a specific pick. The summary must be derived from `audit_log` entries already fetched for that pick.

**Example (permitted):**
> "This pick entered the dead-letter queue after three delivery attempts to discord:best-bets, each failing with a 5xx gateway error. A manual retry was triggered at 14:32 UTC."

### 2.4 Intelligence Workspace Section Summaries

In the Intelligence workspace, LLM may generate a one-paragraph summary of the ROI or calibration data visible on screen. The summary must describe what the data shows — it must not project future performance, suggest score weight adjustments, or claim statistical significance beyond what the displayed confidence badges indicate.

**Example (permitted):**
> "ROI by market shows player points as the strongest market (8.3% ROI, N=142). Player assists and game totals are below threshold sample sizes and results are not reliable."

**Example (prohibited):**
> "The system is likely to continue outperforming on player points given the trend." ← forward projection, not permitted.

---

## Section 3 — Prohibited LLM Use Cases

These prohibitions are absolute. No exception without a new ratified contract amendment.

### 3.1 Invented Scores

LLM may not generate, estimate, or infer promotion scores (edge, trust, readiness, uniqueness, boardFit). All scores must come from `pick_promotion_history`. If scores are unavailable for a pick, the score section displays "No promotion data" — not an LLM estimate.

### 3.2 Fabricated Stats and Records

LLM may not generate win-loss records, ROI percentages, CLV figures, settlement outcomes, or any metric derived from `settlement_records`, `picks`, or `pick_promotion_history`. All such values must be fetched directly from the database via operator-web endpoints.

### 3.3 Hallucinated Analytics

LLM may not produce trend analysis, correlation claims, calibration recommendations, or model feedback unless the underlying numeric data is already computed and rendered by the deterministic domain layer. Commentary on the calibration module (Module 4 in the Intelligence workspace) may only appear after `analyzeWeightEffectiveness()` has returned and the results are displayed.

### 3.4 Status Substitution

LLM may not describe a pick's lifecycle state, approval status, promotion qualification, or delivery status. These are canonical state machine values from `picks.status`, `picks.approval_status`, `pick_promotion_history.promotion_status`, and `distribution_outbox`. They must always be rendered from DB truth. LLM may not paraphrase or restate them in a way that differs from the canonical values.

**Critical language rule:** "Qualified" and "Approved" are not synonyms. LLM must never use these interchangeably. If LLM commentary references promotion state, it must use the exact canonical terms from `CC_IA_RATIFICATION.md` Section 2.2.

### 3.5 CLV Claims Before UTV2-335

LLM may not generate any CLV-related commentary until UTV2-335 is marked Done and `settlement_records.clv_at_close` is proven populated end-to-end. The CLV Cohorts tab is blocked; LLM commentary on CLV performance is equally blocked.

### 3.6 Forward Performance Projections

LLM may not project future pick outcomes, system performance, or capper trajectories. The Intelligence workspace is backward-looking analysis only. "Is likely to", "trending toward", "expected to" are prohibited phrases in LLM-generated commentary.

### 3.7 Replacing Empty State

When a module has insufficient data (N < 50 for ROI, no promotion history, no settled picks), LLM may not generate filler content to make the empty state appear populated. Empty states must display the canonical empty-state UI defined in the module specs (e.g., "Insufficient sample — results not reliable"). LLM-generated placeholder text is prohibited.

---

## Section 4 — Fail-Closed Requirement

### 4.1 Core Rule

Every CC page that includes an LLM commentary section must be fully functional without LLM. If the LLM service is unavailable, degraded, or returns an error, the page renders completely using real data and the LLM section is either hidden or replaced by a silent empty state.

The page must never:
- Block rendering on LLM response
- Display an error that breaks the page layout because LLM failed
- Show a loading spinner in place of canonical data while waiting for LLM

### 4.2 Acceptable Fallback Behaviors

| LLM state | Required fallback |
|---|---|
| Unavailable / timeout | Hide LLM commentary section silently; page renders fully |
| Error response | Same as unavailable — hide silently |
| Slow response (> 3s) | Render page without LLM; LLM section appears only after response arrives (non-blocking async) |
| Empty / empty string | Hide LLM commentary section |
| Content policy refusal | Hide section; do not display the refusal message to operators |

### 4.3 Implementation Pattern

LLM commentary sections must be implemented as non-blocking async components that:
1. Render the full canonical data section immediately on page load
2. Initiate the LLM request in parallel, not sequentially
3. Insert the commentary section only after a valid LLM response arrives
4. Handle all error/timeout states by hiding the commentary section — no error propagation to the canonical data layer

No LLM request may be on the critical path of page load.

---

## Section 5 — Circuit-Breaker Pattern (Readiness 5.11)

### 5.1 Dependency Note

LLM integration in CC is classified as a **readiness 5.11 dependency** — it is a non-critical enhancement layer, not a core system function. Core system function is defined as: pick submission, promotion evaluation, delivery, settlement, and operator review. None of these depend on LLM.

### 5.2 Circuit-Breaker Requirements

Any LLM API call from `apps/command-center` must be wrapped in a circuit breaker with the following behavior:

| State | Trigger | Behavior |
|---|---|---|
| Closed (normal) | < N consecutive failures | LLM requests proceed; commentary renders on success |
| Open (tripped) | N consecutive failures or error rate > threshold | LLM requests suppressed for cooldown period; all pages render without commentary; no user-visible error |
| Half-open (recovery) | After cooldown period expires | One probe request allowed; if successful, close circuit; if failed, re-open for another cooldown |

**Recommended thresholds (adjust at implementation time):**
- Trip after 5 consecutive failures or > 30% error rate in a 60-second window
- Cooldown period: 120 seconds
- Half-open probe: single request

### 5.3 Monitoring

Circuit state must be observable. The Operations workspace Readiness / Health Scorecard (`/burn-in`) must include an LLM circuit state indicator when LLM integration is active. Indicator shows: `nominal` | `open` | `half-open`. This is a display-only addition to the existing scorecard — it does not change the circuit-breaker logic.

### 5.4 No Runtime Coupling

The LLM circuit breaker must operate entirely within `apps/command-center`. It must not affect `apps/api`, `apps/worker`, `apps/operator-web`, or any other app. LLM failure must never propagate to the pick submission or delivery path.

---

## Section 6 — Page-by-Page LLM Scope

### 6.1 Operations Workspace

| Page | LLM permitted | Permitted section | LLM prohibited |
|---|---|---|---|
| Dashboard | No | — | Do not add LLM commentary to health signals, lifecycle table, or system state |
| Readiness / Health Scorecard | No (except circuit state indicator per 5.3) | LLM circuit state badge only | Do not generate narrative about system readiness |
| Picks List | No | — | Do not annotate pick rows with LLM summaries |
| Pick Detail | Yes — limited | Promotion score explanation (Section 2.2) only; rendered below canonical score table | Do not restate lifecycle state, approval status, or delivery status; do not fabricate scores |
| Review Queue | No | — | Do not generate review recommendations or pick summaries |
| Held Picks | No | — | Do not explain why a pick was held |
| Exceptions | Yes — limited | Exception chain summary (Section 2.3) only; rendered below canonical exception data | Do not generate retry recommendations |
| Intervention Log | Yes — limited | Intervention chain summary (Section 2.3) only; rendered below canonical audit rows | Do not narrate expected outcomes of interventions |

### 6.2 Decision Workspace

| Page | LLM permitted | Permitted section | LLM prohibited |
|---|---|---|---|
| Score Breakdown | Yes | Score component plain-language explanation (Section 2.2); rendered below canonical score table | Do not generate alternative scores; do not claim why a pick was or was not qualified |
| Promotion Preview | No | — | Do not generate a pick recommendation; preview is deterministic engine output only |
| Routing Preview | No | — | Do not narrate routing decisions; routing is canonical outbox state only |
| Board Saturation | No | — | Do not generate commentary on board composition |
| Review History | No | — | Do not summarize review decisions |
| Hedge Overlays | No | — | Do not explain hedge opportunities |

### 6.3 Research Workspace

| Page | LLM permitted | Permitted section | LLM prohibited |
|---|---|---|---|
| Prop Explorer | No | — | Do not summarize or interpret line data |
| Line-Shopper | No | — | Do not generate line recommendations |
| Player Card | No | — | Do not generate player analysis or predictions |
| Matchup Card | No | — | Do not generate game previews or predictions |
| Hit Rate | No | — | Do not narrate hit rate results; N-count and volume warnings are canonical UI |

### 6.4 Intelligence Workspace

| Page / Tab | LLM permitted | Permitted section | LLM prohibited |
|---|---|---|---|
| Performance tab | Yes — limited | One-paragraph section summary (Section 2.4); rendered below all canonical tables | Do not generate per-capper commentary; do not project future performance |
| Form Windows tab | No | — | Do not narrate trend windows; trends are deterministic time-series data |
| Calibration tab | Yes — limited | Summary of calibration result after `analyzeWeightEffectiveness()` renders; commentary must not precede canonical output | Do not suggest weight adjustments; do not claim CLV correlation before UTV2-335 |
| CLV Cohorts tab | BLOCKED — do not surface until UTV2-335 is Done | — | No LLM commentary on CLV until tab is unblocked |
| ROI by Tier | Yes — limited | One-sentence summary per tier (e.g., "Diamond: 12% ROI on 87 picks"); inline with volume badge | Do not generate tier performance explanations when N < 20 |
| ROI by Capper | Yes — limited | Same as ROI by Tier | Do not generate per-capper narrative when N < 20 |
| ROI by Market | Yes — limited | Same as ROI by Tier | Do not generate market-level analysis when N < 20 |

---

## Section 7 — Authority Rule

### 7.1 Canonical DB Data Always Wins

If any LLM-generated content conflicts with canonical DB data — whether in value, status label, score, record, or factual claim — the canonical data is correct and the LLM content is wrong.

Resolution rule: canonical data is displayed, LLM content is discarded. The system must never present the operator with a choice between LLM output and DB truth.

### 7.2 Operator Cannot Distinguish Source

LLM commentary sections must be visually labeled as machine-generated summaries (e.g., "AI summary" label or icon). This is not optional. Operators must always be able to distinguish LLM-generated text from DB-sourced values. The canonical data section (tables, metrics, badges, status chips) carries no LLM label.

### 7.3 Precedence Stack

In any conflict or ambiguity:

1. Canonical DB value (from operator-web API response)
2. Deterministic domain computation output (`packages/domain/src/`)
3. LLM-generated commentary

LLM is always last. LLM output never escalates above level 3.

### 7.4 No Cached LLM State

LLM-generated commentary must not be persisted to the database, cached in a way that survives past the operator's session, or written to `audit_log`. Commentary is ephemeral: generated per session, never stored as system state.

---

## Ratification Sign-Off

This document governs all LLM integration decisions in `apps/command-center`. It is grounded in:

- `CC_IA_RATIFICATION.md` — four-workspace model, module shippable/shell/blocked status
- `CC_INTELLIGENCE_WORKSPACE_MVP.md` — Intelligence workspace module specs and volume gate policy
- `CLAUDE.md` system invariants — fail-closed behavior, no hallucinated architecture, contract-first system

**What is ratified:**
- Permitted LLM use cases: narrative wrapping, score explanation, exception summaries, Intelligence section summaries
- Prohibited LLM use cases: invented scores, fabricated stats, status substitution, CLV claims before UTV2-335, forward projections, empty-state filler
- Fail-closed requirement: LLM is never on the critical path; pages render fully without LLM
- Circuit-breaker pattern: readiness 5.11, non-coupling to core pick/delivery/settlement path
- Page-by-page scope: explicit permitted/prohibited breakdown for all four workspaces
- Authority rule: canonical DB data always wins; LLM commentary is always level 3 in precedence

**What is not ratified:**
- Model selection or prompt engineering (implementation detail)
- Infrastructure for LLM API access (separate provisioning decision)
- LLM integration in any app other than `apps/command-center`

**Merge tier:** T3 — governance doc, no runtime change, no migration. Merge on green.
