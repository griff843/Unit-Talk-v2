# Pick Lifecycle and Evidence Modes

**Status:** RATIFIED — 2026-06-10
**Authority:** Architecture doc. Owned by PM (A Griffin).
**Issue:** UTV2-1253
**Cross-references:**
- `docs/06_status/CURRENT_STATE.md` — live program state snapshot
- `docs/05_operations/PROVIDER_DATA_DECISION_RECORD.md` — provider data strategy and math layer verdict
- `docs/05_operations/T1_COMMAND_CENTER_BURNIN_TRUTH_CONTRACT.md` — operator surfaces for burn-in
- `docs/05_operations/MODEL_EDGE_ACCEPTANCE_STANDARD.md` — DEVELOPING / STRONG / ELITE thresholds
- `docs/00_constitution/CANONICAL_PROGRAM_STATE.md` — P1–P5 certification states

---

## Purpose

This document defines the operating modes of the Unit Talk V2 pick pipeline, and the distinction between **evidence eligibility** and **public delivery approval**. It exists because UTV2-1042 returned `INSUFFICIENT_DATA` despite live SGO data and an open CLV/data gate. The cause: `awaiting_approval` held proof-eligible picks, blocking settled CLV-path sample accumulation.

**Core principle:** Public delivery approval and evidence eligibility are distinct controls. A pick may be blocked from public Discord delivery while remaining fully eligible for internal evidence accumulation, CLV tracking, settlement tracking, grading, and Command Center visibility.

This doc is the architectural basis for implementation lanes that decouple evidence flow from public delivery approval. No runtime code changes are made in this lane.

---

## Foundational Distinctions

### 1. Evidence eligibility vs. public delivery approval

| Concept | What it governs | Who controls it |
|---|---|---|
| **Evidence eligibility** | Whether a pick counts toward certification thresholds (CLV sample, settlement proof, calibration data) | Automatic — based on pick origin, market data availability, and non-synthetic status |
| **Public delivery approval** | Whether a pick is posted to public or member Discord channels | Operator / PM approval gate — `awaiting_approval` lifecycle state |

These are independent. Holding a pick in `awaiting_approval` must not suppress its evidence flow.

### 2. Pick counts as evidence only when:

- It is a production-path pick (not `metadata.testRun`, not `source: t1-proof`, not `band: SUPPRESS`, not a proof-fixture)
- It has not been voided
- Its market has closing odds available (`market_universe.closing_over_odds IS NOT NULL`)
- A `pick_candidates` JOIN path exists (`picks → pick_candidates → market_universe`)
- It has a timestamped, reproducible origin (can be re-queried by SHA)
- It has settled outcomes available (`settlement_records` row)

Synthetic picks, smoke-test picks, and proof-harness fixtures must **never** count toward certification thresholds. CLV-path accumulation must be tracked and reported against only the eligible set.

### 3. Command Center is the operator truth layer; Discord is an output channel

Command Center shows all picks regardless of delivery approval status. Discord receives only picks that have passed delivery approval for the configured delivery target. These are independent routing decisions.

---

## Control Planes

The pipeline has three logical planes. All three must be independently observable and independently controllable.

### Plane 1 — Evidence / Data Plane

**Scope:** Ingest → score → evaluate → CLV-track → settle → grade → report to Command Center.

**Invariants:**
- Runs regardless of delivery approval state
- Not gated by `awaiting_approval`
- Accumulates CLV-path data from all eligible picks whether or not they were posted
- Settlement tracking runs on all picks that have game outcomes
- Grading runs on all picks with settlement data
- CLV is computed on-read via `picks → pick_candidates → market_universe → closing_over_odds`

**What blocks evidence accumulation (legitimately):**
- No closing odds (markets still open — not a bug)
- No `pick_candidates` row for the pick's universe (scan pipeline not yet run — operational)
- Pick is synthetic (correct exclusion — not a governance issue)
- Pick is voided (correct exclusion)

**What must NOT block evidence accumulation:**
- `awaiting_approval` status
- Governance brake holding a pick from Discord delivery
- Public Discord channel not configured
- Canary/test channel delivery failure

### Plane 2 — Command Center / Operator Plane

**Scope:** Operator visibility of all picks, pipeline health, delivery state, intelligence coverage, CLV accumulation.

**Invariants:**
- Shows all picks regardless of approval or delivery status
- Displays lifecycle state accurately (including `awaiting_approval`, `draft`, `validated`, `queued`, `posted`, `settled`, `voided`)
- Shows CLV coverage rate, settled pick count, evidence accumulation metrics
- Surfaces governance brake queue size and aging separately from system failures

**Required surfaces (per `T1_COMMAND_CENTER_BURNIN_TRUTH_CONTRACT.md`):**
- Pick counts by lifecycle state
- CLV coverage rate (eligible picks with closing odds)
- Intelligence enrichment coverage (domainAnalysis, deviggingResult, kellySizing, realEdge)
- Provider health (ingest cycles, freshness)
- Outbox state, worker runtime, delivery metrics per target

### Plane 3 — Public Delivery Plane

**Scope:** Discord posting to public channels, member channels, canary channels, or test channels.

**Invariants:**
- Requires explicit approval gate before posting to public/member channels
- `awaiting_approval` is the correct state for picks pending public delivery approval
- Governance brake (P7A) applies here — autonomous-source picks require PM/operator approval before public delivery
- Canary/test/internal Discord postings may be allowed at lower approval threshold (mode-dependent)
- Discord delivery failure must never affect evidence accumulation or Command Center visibility

**What this plane does NOT govern:**
- CLV data flow
- Settlement or grading
- Command Center visibility
- Evidence eligibility

---

## Operating Modes

The system operates in exactly one of four named modes at any time. The current mode is set by PM/operator decision and must be stated explicitly in `docs/06_status/CURRENT_STATE.md`.

---

### Mode 1: Evidence Accumulation / Controlled Validation

**Current mode as of 2026-06-10.**

**Goal:** Prove the runtime and model loop works. Accumulate a statistically credible settled CLV-path sample. No public claims.

#### Evidence / Data Plane
- Ingest, score, evaluate, CLV-track, settle, grade: **fully active**
- All eligible picks flow through evidence tracking regardless of delivery status
- CLV accumulation monitored continuously (see UTV2-1231)
- Certification thresholds tracked: DEVELOPING requires ≥ 50 settled CLV-path picks

#### Command Center / Operator Plane
- All picks visible: drafts, validated, queued, awaiting_approval, posted, settled, voided
- Evidence metrics visible: CLV coverage rate, settled count, pick-by-pick CLV direction
- Governance brake queue visible with aging — not counted as system failures
- Provider health, ingestor cycles, and board-scan recency visible

#### Public Delivery Plane
- Public/member Discord: **suppressed unless operator explicitly enables per-pick**
- Canary/internal Discord: **allowed** — controlled single-channel test delivery with manual approval
- P7A governance brake: **active** — autonomous-source picks require PM approval before any delivery
- Manual approval by operator/PM gates each public post

#### Pick lifecycle expectations
```
ingest → score → evaluate → pick_candidates (scan)
       → awaiting_approval (P7A brake on autonomous sources)
       → [evidence continues regardless]
       → CLV tracked when closing odds arrive
       → settled/graded by automated grading service
       → Command Center shows all states
       → [public Discord: suppressed — operator approves individually]
       → [canary Discord: allowed on approval]
```

#### Proof criteria
- No P3 certification
- No CLV / ROI / edge claims
- No DEVELOPING / STRONG / ELITE label unless `MODEL_EDGE_ACCEPTANCE_STANDARD.md` thresholds met
- Evidence bundle required for any tier transition (UTV2-1032 / UTV2-1033 gates)

#### Forbidden claims
- Proven edge
- Positive EV
- Syndicate-ready
- Any win-rate claim citing N < 50 settled CLV-path picks

---

### Mode 2: Discord Delivery Test Mode

**Goal:** Test Discord embedding, routing, channel assignment, receipts, thread behavior, and user-facing delivery mechanics. Not for public claims.

#### Evidence / Data Plane
- Fully active — same as Mode 1

#### Command Center / Operator Plane
- Fully active — same as Mode 1
- Delivery receipt tracking visible per channel and target

#### Public Delivery Plane
- Canary Discord: **active** — test posts to canary/internal channels
- Test-channel delivery: **allowed** — specific configured test channels only
- Public/member Discord: **allowed only with manual approval per pick**
- Automated delivery to public: **blocked**
- Post noise is limited — target is delivery mechanics proof, not volume

#### Pick lifecycle expectations
```
[same as Mode 1 evidence flow]
       → canary delivery: allowed on manual approval
       → test-channel delivery: allowed
       → public delivery: one-at-a-time with explicit operator approval
       → receipt confirmation tracked and visible in Command Center
```

#### Proof criteria
- Delivery receipts prove Discord mechanics work
- Evidence accumulation continues — same thresholds as Mode 1
- No public performance claims

#### Forbidden claims
- Any performance or edge claim from delivery test volume
- "Discord works therefore system is production-ready"

---

### Mode 3: Manual Approval Production Mode

**Goal:** Production-facing delivery while the system is not yet certified. Operator or PM approves each public post. Evidence tracking continues for all eligible picks.

#### Evidence / Data Plane
- Fully active
- CLV and settlement tracking continues for all approved and non-approved picks alike
- Evidence pool includes picks whether or not they were approved for public delivery

#### Command Center / Operator Plane
- Fully active
- Approval queue visible with aging — picks pending public approval are surfaced
- Per-pick approval workflow: operator reviews pick details, approves or rejects in Command Center

#### Public Delivery Plane
- Public Discord: **allowed after operator/PM approval per pick**
- Canary Discord: **allowed**
- Automated public delivery: **blocked** — every public post requires a human approval action
- Delivery SLO tracked per target

#### Pick lifecycle expectations
```
ingest → score → evaluate → awaiting_approval
       → [operator reviews in Command Center]
       → approved: queued → posted → settled
       → rejected: voided or returned to draft
       → [evidence tracks both approved and rejected picks for CLV/calibration]
```

#### Proof criteria
- P3 certification possible if `MODEL_EDGE_ACCEPTANCE_STANDARD.md` DEVELOPING threshold met from eligible pool
- P3 cert requires: ≥ 50 settled CLV-path picks, positive median CLV, positive ROI, ≥ 60% CLV coverage
- Certification claims must cite specific evidence bundle with merge SHA binding

#### Forbidden claims
- Automated delivery performance claims without DEVELOPING threshold met
- Syndicate-readiness without ELITE threshold met
- Any claim that manual approval implies certified edge

---

### Mode 4: Certified Automated Delivery Mode

**Goal:** Automated public and member delivery. Requires prior certification. Kill switches remain active.

**Entry requires (all must be met):**
- At minimum P3 DEVELOPING certification (UTV2-1032) — `MODEL_EDGE_ACCEPTANCE_STANDARD.md`
- For STRONG claims: P3 STRONG certification (UTV2-1033)
- `pnpm verify` green on production SHA
- Runtime health: no FAILED signals for 72h continuous
- CLV data arriving within 24h of settlement
- PM approval to enter this mode

#### Evidence / Data Plane
- Fully active
- Automated evidence accumulation continues to maintain certification freshness
- DEVELOPING/STRONG: re-measurement per cadence in `MODEL_EDGE_ACCEPTANCE_STANDARD.md`
- Invalidation conditions monitored continuously (30-consecutive-pick losing streak, CLV coverage drop, etc.)

#### Command Center / Operator Plane
- Fully active
- Certification status and expiry visible
- Kill switch state visible
- Evidence freshness countdown visible (re-cert deadlines per `MODEL_EDGE_ACCEPTANCE_STANDARD.md`)

#### Public Delivery Plane
- Automated public/member delivery: **allowed** within product policy
- Delivery still routed through outbox; receipts tracked
- Kill switches remain active — operator can halt delivery at any time
- Any invalidation condition (see `MODEL_EDGE_ACCEPTANCE_STANDARD.md §Invalidation Conditions`) reverts delivery to Mode 3 immediately

#### Claims permitted
- DEVELOPING claims if DEVELOPING evidence bundle is current and SHA-bound
- STRONG claims if STRONG evidence bundle is current and SHA-bound
- ELITE / SYNDICATE_READY claims only after ELITE threshold met and PM-ratified

#### Forbidden claims
- Claims beyond the certified tier
- ROI or CLV claims from evidence older than the `MODEL_EDGE_ACCEPTANCE_STANDARD.md` staleness threshold for the tier
- "Syndicate-ready" without ELITE cert on at least one cohort

---

## Pick Lifecycle Expectations by Mode

The pick status FSM is unchanged across modes. What changes is which transitions trigger delivery actions.

```
draft → validated → queued → [awaiting_approval] → posted → settled
                                                 ↓
                                              voided
```

| State | All modes: evidence eligible? | Mode 1: public delivery? | Mode 2: public delivery? | Mode 3: public delivery? | Mode 4: public delivery? |
|---|---|---|---|---|---|
| `draft` | No (incomplete) | No | No | No | No |
| `validated` | Yes (if not synthetic) | No | No | No | Automated queue |
| `queued` | Yes | No | No | No | Automated queue |
| `awaiting_approval` | **Yes** | No | No | After approval | After approval (kill-switch permitting) |
| `posted` | Yes | Canary only | Canary + test channel | Yes (post-approval) | Yes (automated) |
| `settled` | Yes (settlement evidence) | N/A | N/A | N/A | N/A |
| `voided` | No | No | No | No | No |

**Critical rule:** `awaiting_approval` picks are evidence-eligible. Their CLV data, settlement outcomes, and grading results must flow through the evidence pipeline. They are excluded from public delivery, not from evidence accumulation.

---

## Evidence Eligibility vs. Public Delivery Approval

| Factor | Blocks public delivery | Blocks evidence flow |
|---|---|---|
| `awaiting_approval` state | **Yes** | **No** |
| P7A governance brake | **Yes** (autonomous sources) | **No** |
| No canary channel configured | Yes (canary) | **No** |
| No closing odds available | No | Yes (CLV unavailable — operational) |
| No `pick_candidates` row | No | Yes (JOIN path missing — operational) |
| Pick is synthetic (`testRun`, `t1-proof`, etc.) | Implicit | **Yes** — excluded from evidence |
| Pick is voided | Final state — no delivery | **Yes** — excluded from evidence |

---

## What Command Center Must Show

Regardless of operating mode:

1. **Pick counts by lifecycle state** — including `awaiting_approval` queue size and aging
2. **Governance brake queue** — separate from system failure counts (per UTV2-1248)
3. **Evidence accumulation metrics:**
   - Total post-cutover settled picks
   - Settled picks on CLV join path (certification sample)
   - CLV coverage rate (% of eligible settled picks with `closing_over_odds`)
   - Picks remaining before DEVELOPING threshold (50 settled CLV-path picks)
4. **Provider health** — ingest cycles, freshness, market universe coverage
5. **Delivery state per target** — canary, best-bets, public; sent/failed/dead-letter per channel
6. **Current operating mode** — displayed prominently; must match `CURRENT_STATE.md`

---

## When Discord Should Receive Posts

| Channel type | Mode 1 | Mode 2 | Mode 3 | Mode 4 |
|---|---|---|---|---|
| Canary / internal | With approval | Active | With approval | Active |
| Test channel | No | Active | No | No (not needed) |
| Public / member | Suppressed | Suppressed (per-pick exception only) | After operator/PM approval per pick | Automated (kill-switch permitting) |

**Default position during Evidence Accumulation (Mode 1):** public Discord suppressed. Enabling per-pick canary delivery requires explicit operator action.

---

## When Public Delivery Is Suppressed

Public delivery is suppressed when:
- Current mode is Mode 1 (Evidence Accumulation) — default
- P7A governance brake is active and pick source is autonomous
- Pick is in `awaiting_approval` and no operator approval has been issued
- Kill switch is active (any mode)
- Certification has lapsed (Mode 4 reverts to Mode 3 on invalidation)
- PM has not yet approved mode transition to Mode 3 or Mode 4

Suppression of public delivery does **not** suppress evidence flow.

---

## When Canary / Internal Discord Is Allowed

Canary delivery is allowed in all modes subject to:
- Explicit operator action (Mode 1, Mode 3) or automatic routing (Mode 2, Mode 4)
- Canary channel configured in delivery targets
- Pick not voided and not synthetic
- P7A brake clearance for autonomous-source picks (canary is a delivery channel — brake applies)

Canary delivery does count as a delivered post for receipt/SLO tracking. It does not count toward certification sample size unless the pick also satisfies evidence eligibility criteria.

---

## How Manual Approval Works

Manual approval applies to **public delivery** only. It does not gate evidence flow.

### Approval path

1. Pick reaches `awaiting_approval` state (P7A brake for autonomous sources, or mode policy for all picks in Mode 3)
2. Operator reviews in Command Center: pick detail, model scores, market info, CLV direction (if available)
3. Operator approves → pick transitions to `queued` → outbox created → delivery attempted
4. Operator rejects → pick transitions to `voided` (evidence still tracked for CLV/calibration on the rejected pick, excluding it from settled-CLV-path count)

### What approval does and does not do

| Approval action | Effect |
|---|---|
| Approve a pick | Enables public/member delivery for that pick |
| Reject a pick | Voids it from delivery; evidence tracking continues for pre-void data |
| Approve a pick | Does NOT certify edge or performance |
| Approve many picks | Does NOT constitute P3 certification or DEVELOPING claim |
| Not approving a pick | Does NOT suppress its CLV data, settlement tracking, or grading |

---

## How Settlement and CLV Tracking Should Behave

### Settlement tracking

Settlement tracking runs on all non-voided, non-synthetic picks with matching `game_results` entries, regardless of delivery status. A pick that was held in `awaiting_approval` and never posted should still settle and grade if the game completed.

Settlement records (`settlement_records` table) must be created for:
- All picks with a resolved game outcome
- Regardless of pick approval or delivery state
- Including `awaiting_approval` picks where the event settled before the pick was approved

### CLV tracking

CLV is computed on-read via: `picks → pick_candidates (pick_id) → market_universe (universe_id) → closing_over_odds`

CLV must be tracked for:
- All picks on the join path, regardless of delivery approval
- Including picks that were held in `awaiting_approval` and never posted

CLV must **not** be tracked for:
- Synthetic picks (testRun, t1-proof, proof-fixture, SUPPRESS band)
- Voided picks
- Picks with no `pick_candidates` row (join path missing)
- Picks whose `market_universe` row has no `closing_over_odds` (open markets — this is operational, not a policy block)

### Evidence sample eligibility

For certification sample purposes (`MODEL_EDGE_ACCEPTANCE_STANDARD.md`):

| Pick characteristic | Eligible for DEVELOPING/STRONG/ELITE sample? |
|---|---|
| Settled, CLV-path, non-synthetic, non-voided | **Yes** |
| Settled, no CLV path | No — excluded from CLV-required thresholds |
| Awaiting_approval, not yet settled | Not yet — will count when settled |
| Voided | **No** |
| Synthetic | **No** |
| Pre-cutover (pre Wave-5 deploy `b4188980`) | Excluded from post-cutover analysis |

---

## Proof Criteria and Forbidden Claims

### Proof criteria by mode

| Mode | Minimum proof | Certification possible? |
|---|---|---|
| Mode 1 (Evidence Accumulation) | Data-gate open, evidence accumulating | **No** — insufficient sample |
| Mode 2 (Discord Delivery Test) | Delivery receipt proof | No performance certification |
| Mode 3 (Manual Approval Production) | ≥ 50 settled CLV-path picks + positive median CLV + positive ROI | P3 DEVELOPING possible (UTV2-1032) |
| Mode 4 (Certified Automated Delivery) | Full evidence bundle per tier | Claims limited to certified tier |

### Always forbidden (regardless of mode)

- P3 certification without empirical evidence meeting `MODEL_EDGE_ACCEPTANCE_STANDARD.md`
- "Proven edge" without out-of-sample N ≥ 100
- "Positive EV" without CLV coverage ≥ 60%
- "Syndicate-ready" without ELITE label on at least one cohort
- Any win-rate claim citing N < 50 settled CLV-path picks
- ROI claims from evidence older than tier-specific staleness threshold
- Claims that `awaiting_approval` state implies quality review has certified picks as profitable

---

## Transition Criteria Between Modes

### Mode 1 → Mode 2

- Operator decides to test Discord delivery mechanics
- No certification requirement
- PM awareness required; no PM approval gate
- Automatically reverts to Mode 1 after delivery test window if no further decision

### Mode 2 → Mode 3

- PM decision to enter production delivery
- No certification requirement for Mode 3 entry
- P7A governance brake remains active
- `CURRENT_STATE.md` updated to reflect mode change

### Mode 3 → Mode 4

All of the following required:
1. DEVELOPING certification (UTV2-1032): ≥ 50 settled CLV-path picks, positive median CLV, positive ROI, ≥ 60% CLV coverage, all per `MODEL_EDGE_ACCEPTANCE_STANDARD.md`
2. Evidence bundle with merge SHA binding
3. `pnpm verify` green on production SHA
4. Runtime health: no FAILED signals for 72h continuous (per `T1_COMMAND_CENTER_BURNIN_TRUTH_CONTRACT.md` §5c criterion 7.12)
5. PM `t1-approved` label on UTV2-1032 (DEVELOPING) or UTV2-1033 (STRONG) as applicable
6. `CURRENT_STATE.md` updated; P3 state advanced from ACTIVE_NOT_CERTIFIED to ACTIVE_CERTIFIED

### Mode 4 invalidation (auto-revert to Mode 3)

Any of the following triggers immediate revert to Mode 3 (per `MODEL_EDGE_ACCEPTANCE_STANDARD.md §Invalidation Conditions`):
- 30-consecutive-pick losing streak at fair odds
- CLV coverage drops below 50% for 14+ consecutive days
- ROI over trailing 100 bets becomes negative at 95% CI
- Calibration error exceeds ±10 pp for 3 consecutive weeks
- Runtime proof becomes stale (evidence SHA diverges from production SHA)
- PM-initiated reset

---

## Relationship to P3/P4/P5 Certification States

Certification states are defined in `docs/00_constitution/CANONICAL_PROGRAM_STATE.md` and governed by `docs/00_constitution/UNIT_TALK_CONSTITUTION_V1.md §18.3`.

| Certification state | Meaning | Operating mode implication |
|---|---|---|
| **P3 ACTIVE_NOT_CERTIFIED** | Decision Integrity work authorized; no edge certification | Mode 1 or Mode 2 — evidence accumulation only |
| **P3 ACTIVE_CERTIFIED (DEVELOPING)** | ≥ 50 settled CLV-path picks, positive CLV/ROI | Mode 3 permitted; Mode 4 permitted with PM decision |
| **P3 ACTIVE_CERTIFIED (STRONG)** | ≥ 200 settled picks, ≥ +2% ROI, tighter CI | Mode 4 with wider automated delivery permitted |
| **P3 ACTIVE_CERTIFIED (ELITE)** | ≥ 500 settled picks, full calibration, multi-sport | Syndicate-readiness claims possible |
| **P4 CONDITIONAL_NOT_CERTIFIED** | Economic truth work authorized; no ROI/CLV cert | No economic claims in any mode |
| **P4 ACTIVE_CERTIFIED** | Realized CLV/attribution proven | Economic truth claims permitted in Mode 4 |
| **P5 FROZEN_NOT_CERTIFIED** | Capital/treasury frozen | Treasury work forbidden in all modes |

**Current state (2026-06-10):** P3 ACTIVE_NOT_CERTIFIED, P4 CONDITIONAL_NOT_CERTIFIED, P5 FROZEN_NOT_CERTIFIED.
**Current operating mode:** Mode 1 — Evidence Accumulation / Controlled Validation.

No mode transition is authorized until the transition criteria above are met.

---

## Current Mode Statement (Unambiguous)

> **Unit Talk V2 is operating in Mode 1: Evidence Accumulation / Controlled Validation.**
>
> Public Discord delivery is suppressed except for individually operator-approved canary posts.
> Evidence accumulation (ingest, scoring, CLV tracking, settlement, grading) is fully active for all eligible picks.
> `awaiting_approval` picks are evidence-eligible and must flow through CLV and settlement tracking.
> No P3 certification. No CLV / ROI / edge claims. No DEVELOPING / STRONG / ELITE label.
>
> Next threshold: ≥ 50 settled CLV-path picks for DEVELOPING (UTV2-1032).
> Current count: 0 (as of UTV2-1042 evidence evaluation 2026-06-10).

---

## Authority and Update Rule

This document is T2. Operating mode transitions require PM decision and `CURRENT_STATE.md` update. Proof criteria, CLV thresholds, and invalidation conditions are defined in `MODEL_EDGE_ACCEPTANCE_STANDARD.md` — if that document conflicts with this one, `MODEL_EDGE_ACCEPTANCE_STANDARD.md` wins on evidence thresholds. This document governs mode gating; that document governs proof standards.

Implementation lanes that change runtime behavior to reflect these modes (decoupling evidence flow from `awaiting_approval` gating) require a separate PM-approved lane with this doc as the architectural basis.
