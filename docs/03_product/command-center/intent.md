# Command Center — Product Intent

**Status:** ACTIVE. **Owner:** PM (Griff) for intent; Claude for reconciliation against live truth.
**Consolidated:** 2026-09-19, from `COMMAND_CENTER_REDESIGN_CONTRACT.md` (FINAL), the twenty
other Command Center documents listed in §2, the implementation on `main`, and production
measurements taken the same day against `zfzdnfwdarxucxtaojxm`.

This document states **what the Command Center is for and what it must do**. It is a product
intent, not a new contract family, not a gate, and not a process. It introduces no threshold, no
required check, no approval artifact and no new lane type. Where a canonical contract already
governs a behaviour, this file points at it rather than restating it.

`CLAUDE.md` reserved this file's slot with the note *"written when that product is next worked."*
That is now.

**It is not a new plan competing with the existing contracts.** The problem it solves is the
opposite of a missing plan: there are **twenty-one** Command Center documents, the newest
substantive one is from April, one of them is a hollow stub, and none of them says what is true
today or what to do next. §2 dispositions them; §3 measures reality; §5 orders the work.

---

## 1. What the Command Center is

`COMMAND_CENTER_REDESIGN_CONTRACT.md` is FINAL and approved, and its north star is the whole
product in one sentence:

> Command Center must allow an operator, in the blink of an eye, to determine what parts of the
> Unit Talk lifecycle are working and what parts are not.

Its closing statement is the test: *"If an operator cannot instantly determine what is working and
what is broken, the system has failed."*

Two consequences follow, and both are routinely lost.

**The Command Center is the operator's only sanctioned window into production.** Mission intent
reserves production DDL and data deletion to Griff, and `DB_ENVIRONMENT_OPERATOR_POLICY.md`
governs what may be run against a live database at all. When the Command Center cannot answer a
question, the answer is not "run a query" — the answer is that the operator cannot act. Every
hour this surface is down is an hour the pipeline is unobservable to the person who owns it.

**It is a control surface, not only a dashboard.** Manual settlement, correction, review, hold,
retry, requeue and promotion override are operator *actions* the contract requires
(§8 of the redesign contract). A read-only Command Center has not met its intent at 90%; it has
met a different intent.

### What it is not

Per the redesign contract's own non-goals: it is not member-facing, not a leaderboard, not an
analytics product, and not a second home for business logic. `apps/command-center/CLAUDE.md`
carries the architectural version of this — reads go through `src/lib/data/`, writes go through
`apps/api`, and no scoring, promotion or settlement logic lives here.

---

## 2. The document landscape, dispositioned

Twenty-one documents mention or govern this product. Read this table instead of discovering them
one at a time; four of them are worth opening, and the rest are April-era design material.

| Document | What it actually is | Use it for |
|---|---|---|
| `docs/03_product/COMMAND_CENTER_REDESIGN_CONTRACT.md` | **FINAL — APPROVED.** V1.1. The destination. | **Authority.** Acceptance criteria in §13. |
| `docs/03_product/COMMAND_CENTER_LIFECYCLE_MINIMUM_SPEC.md` | 2026-03-25. The minimum surface for tracing one pick end to end. | **Authority for the E2E minimum.** Narrower and more testable than the redesign contract. |
| `docs/03_product/COMMAND_CENTER_PHASE_2_CONTRACT.md` | DRAFT — ready for implementation. Review + performance workspace. | Direction *after* Phase 1 acceptance. Not in force. |
| `docs/03_product/COMMAND_CENTER_WAVE_3_CONTRACT.md` | **A hollow stub.** Ten lines, whose body reads *"Full contract text in conversation context. See conversation for sections 1-13."* That conversation no longer exists. | **Nothing.** It governs nothing and cannot be complied with. Do not cite it. Either reconstruct it deliberately or delete it — a document that points at a lost conversation is worse than an absent one. |
| `docs/05_operations/COMMAND_CENTER_AUDIT.md` | Audit dated 2026-04-07. | History. Re-measure before relying on any figure. |
| `docs/05_operations/T1_COMMAND_CENTER_BURNIN_TRUTH_CONTRACT.md` | RATIFIED 2026-04-01. | In force for burn-in truth. |
| `docs/05_operations/T1_CANONICAL_OPERATOR_REVIEW_QUEUE_CONTRACT.md` | The review queue's governing contract. | **Authority** for anything touching `/review` or `/held`. |
| `CC_*.md` × 14 (`IA_RATIFICATION`, `NAV_REDESIGN_SPEC`, `MODULE_PATTERNS`, `MODULE_DEPENDENCY_MAP`, `LANGUAGE_GUIDE`, `DECISION_OVERLAYS_SPEC`, `INTELLIGENCE_*`, `ANALYTICS_SEQUENCE`, `PLAYER_RESEARCH_DATA_MODEL`, `PROVIDER_TRUTH_VALIDATION_PANEL`, `LLM_GOVERNANCE`, `COMPETITOR_BENCHMARK`, `UNIFICATION_TIER_CLASSIFICATION`) | Design specs, each tied to a UTV2-4xx issue from April. Two declare themselves blocked on live provider data. | Reference when working that module. **Not a queue.** Per mission intent, revalidate before relying on any of them. |

**The rule going forward:** extend the canonical contract, never write a twenty-second document.
This file is an index and a reconciliation; if it starts accumulating requirements, that is the
signal it has gone wrong.

---

## 3. Current state — measured, not recalled

All figures measured 2026-09-19 against production `zfzdnfwdarxucxtaojxm` and the implementation
on `main`. Re-measure before quoting; every one of these moves.

### It is deployed, enabled, and reachable

`UNIT_TALK_COMMAND_CENTER_ENABLED=true`; the service is in the deployed compose set. Enabling it
was never a containment change — the flag gates that service's env file, image promotion, compose
membership and smoke check, and touches no delivery or autorun setting.

### The surface is large and substantially real

- **56 route files**, of which **12 are redirect stubs** → **44 distinct pages**.
- **11 server actions** across 7 files: `settlePick`, `reviewPick`, `bulkReviewPicks`,
  `retryDelivery`, `requeueDelivery`, `rerunPromotion`, `overridePromotion`, `submitBuiltPick`,
  `writeSystemPicks`, `submitModelHealthDecision`, `loadPickDetail`.
- A read-only Playwright sweep of every route rendered the substantial majority successfully.

The redirect stubs matter for reading any failure report: `/decisions`→`/review`,
`/picks-list`→`/picks`, `/agents`+`/ops`+`/runtime-dashboard`+`/burn-in`→`/api-health`,
`/interventions`+`/fire-board`→`/exceptions`, `/operations/results`→`/settlement`,
`/research`→`/research/lines`, `/research/hit-rate`→`/research/trends`,
`/research/matchups`→`/intel/teams`. **A sweep that counts routes over-counts defects.** Twelve
reported failures were five distinct pages plus five harness artifacts plus two stubs.

### The central fact: the control surface has never been used

Every operator-write surface, all time:

```
audit_log, actor = 'operator:command-center:HGkYXQqj'
  discord_kill_switch.released   official-picks   2026-09-18 06:31:20.9
  discord_kill_switch.engaged    official-picks   2026-09-18 06:31:22.8
```

That is the complete production write history of this product — two kill-switch toggles, 1.9
seconds apart. Beyond them:

- `settlement_records`: every row is `codex`, `authorizer-*`, `utv2-*-proof`, `proof-runner`, a
  `test-*` fixture, or — for the six real September settlements — **`operator:claude-agent`,
  written through the API directly**, not through this UI.
- `pick_reviews`: no Command Center actor has ever written one. The newest row of any kind is a
  proof runner from 2026-07-30.

**So redesign-contract acceptance criteria 1, 3 and 6 are failed today**, and failed in the same
place: *"a pick can be tracked from submission to settlement entirely in Command Center"*,
*"manual settlement works reliably"*, and *"no external tools are required"*. Each real settlement
to date used an external tool. The settle path is not known-broken — it is **unexercised**, which
is a different and less comfortable risk, because nothing has yet proven it works.

This is also the binding constraint on the Human Capper lifecycle: its remaining steps require
Griff to settle a pick *through this surface*, and that click has no precedent.

### Operator latency, and why clicks felt dead

Measured through the operator bridge against the deployed release:

| Cause | Measurement | Status |
|---|---|---|
| Root layout ran `getPrivilegedGlobalHealth()` — 18 queries — on every request, including 404s | a 404 took **5.49s**; a static asset 0.002s | repaired, UTV2-1942 |
| Three consumers read `system_runs` with a global ordering | **11,501ms**, and 97.5% of the table is `worker.heartbeat`, so the reads returned *only* heartbeats and every latest-run summary was structurally empty while looking successful | repaired → 98.8ms |
| `searchPicks` counted `picks_current_state` | **8,979ms** against the 8s `authenticated` timeout, so `/picks` rendered a raw Postgres error | repaired → 47ms, same exact total |
| Only 2 of 56 routes declared `loading.tsx` | the App Router keeps the *previous* page mounted and interactive for the whole server render — indistinguishable from a click that did nothing | repaired |
| React attaches 9.6–14.7s after navigation begins | every click before that lands on server-rendered HTML with nothing bound, and is silently dropped | **the symptom**; addressed by removing the latency above, not by a hydration change |

Two defects remain open and are **not** repaired by the above:

- **`/review`, `/held`, `/operations/approvals`.** `getReviewQueue`/`getHeldQueue` count with
  `count: 'exact'` and then drop fixture rows in JavaScript. The operator is shown **19,796**
  items when the listed rows come from a population of **2,284** — wrong by 8.7×, in the
  direction that makes the queue look hopeless. The same bug is the latency: the exact count
  drags 21,871 rows through three correlated laterals, touching **205,504 shared buffers** and
  spilling to disk. Warm it is 639ms; cold it crosses 8s, so `/review` timed out on 2 of 6
  consecutive probes. Pushing the fixture predicate into the query fixes both —
  **231ms, 62,663 buffers, no disk spill** — with no DDL.
- **`/intelligence/attribution`.** `getBoardPerformance()` reads `v_governed_pick_performance`
  unbounded: **270,507 rows across 29,164 board runs**, 10,688ms, external merge sort spilling
  147MB + 168MB. It is also incoherent, not merely slow — ordering `board_rank` across 29,164
  independent runs interleaves 29,164 different rank-1 rows. The function already accepts a
  `boardRunId` the page never passes; the newest run is 8 rows.

### Five repairs are merged and not running

`961f17c64..main` carries UTV2-1932, -1935, -1936, -1939 and -1940 — operator decision fields,
suppression reasons, the fixture-guard presence check, honest recap reporting, and settlement
state derived from the settlement plane. **Merged is not running.** Only a successful `Deploy`
run establishes what executes, and only for the SHA it ran at. Dispatching one is reserved
action 8.

---

## 4. What governs each surface

Point here rather than restating; where a contract is wrong, correct the contract in place.

| Surface | Governed by |
|---|---|
| Health signals, status values, detection basis | `COMMAND_CENTER_REDESIGN_CONTRACT.md` §4 |
| Pick lifecycle table, detail view, required columns | same, §6.2–6.3; `COMMAND_CENTER_LIFECYCLE_MINIMUM_SPEC.md` |
| Manual settlement and correction | same, §6.4–6.5, §8; `T1_AUTOMATED_GRADING_CONTRACT.md`; `SCORE_PROVENANCE_STANDARD.md` |
| Review queue, hold, suppression | `T1_CANONICAL_OPERATOR_REVIEW_QUEUE_CONTRACT.md`; `INTERNAL_PICK_APPROVAL_PROTOCOL.md` |
| Approval semantics | `INTERNAL_PICK_APPROVAL_PROTOCOL.md` — approval is for **system-generated** picks; a human capper submission must not enter `awaiting_approval` merely because it is delivery-eligible |
| Kill switch and delivery state | `DELIVERY_KILL_SWITCH.md`; `delivery_operating_model.md` |
| Stats and CLV rendering | `T1_CLV_CLOSING_LINE_WIRING_CONTRACT.md`; `T2_CLV_SETTLEMENT_WIRING_CONTRACT.md` |
| Stale/degraded data behaviour | `T2_STALE_DATA_BEHAVIOR_CONTRACT.md` |
| Authority model, who may act | `COMMAND_CENTER_REDESIGN_CONTRACT.md` §11; `DB_ENVIRONMENT_OPERATOR_POLICY.md` |
| Architecture rules | `apps/command-center/CLAUDE.md` |

---

## 5. The plan

Ordered by what unblocks what. Every item is provider-independent unless marked, per the standing
owner directive that SGO stays intentionally off and is activated near the end as a bounded
data-input dependency.

### Phase A — make the surface trustworthy (in flight)

**A1. Operator latency and the dead-click symptom.** UTV2-1942 / PR #1614. Root-layout read,
`system_runs` fan-out, `searchPicks` count, route-transition boundary. *In CI.*

**A2. The review-queue count and its timeout.** One change fixes an 8.7× false total and an
unpassable page. Blocked only by A1's `apps/command-center/**` scope lock. Measured repair in §3.

**A3. Bound `/intelligence/attribution` to a board run.** Query-layer only; changing the view is
production DDL.

### Phase B — prove the control surface works at all

This is the phase the product actually turns on, and the one with no precedent.

**B1. Prove one settlement end to end through the UI.** Not a test double — a real pick, settled
by an operator clicking the button, producing a `settlement_records` row attributed to
`operator:command-center:*`. Until this exists, acceptance criteria 1, 3 and 6 are unmet and the
Human Capper lifecycle cannot advance. Requires the deploy (reserved action 8) and an operator
action; everything up to the click is stageable now.

**B2. Extend that proof to the other ten actions.** Review, bulk review, hold, retry, requeue,
rerun and override promotion are all unexercised in production. They need the same treatment,
prioritised by what the lifecycle depends on — review and hold before promotion override.

**B3. A route-level regression sweep that is honest about stubs and intermittency.** The existing
sweep needed two corrections: it counted redirect stubs as distinct findings, and it probed once,
so it could not see that `/review` fails 2 times in 6. Fold both lessons in: resolve redirects,
probe repeatedly, and never click a mutation control against live data.

**B4. The Pick Builder is a trap, not yet a mess.** `UTV2-1941`, open in the backlog. Verified
from code here rather than taken from the issue: `submitBuiltPick`
(`actions/execution.ts:23`) posts `{...draft, submittedBy}` to `/api/submissions`, and
`SubmissionDraft` (`lib/pick-builder-model.ts:118`) is `source: 'api'` with **no
`distributionMode` anywhere in the path**. The governed Smart Form contract keys on that field,
and so does the governed cohort predicate `metadata ? 'distributionMode'` — so a pick created
here is invisible to every governed surface, under a UI that promises approval.

It has **created nothing yet**:

```sql
select count(*) from picks where metadata->>'composer' = 'command-center-pick-builder';
-- 0
```

Zero rows, consistent with the rest of §3 — this write surface has never been used either. So
there is no cleanup to do and no orphaned data to reconcile. What there is, is a live trap: the
first operator to use it creates an ungoverned pick, and nothing in the UI will say so. Fix it
before Phase B invites anyone to click things.

### Phase C — meet the redesign contract's Phase 1 acceptance

**C1. Health signals per §4** — working / degraded / broken, with the contract's detection basis,
not a green badge that means "the request returned".

**C2. Lifecycle visibility per §3** — submission, scoring, promotion, delivery, settlement, stats
propagation, and *the exact failure point*, without external tools.

**C3. Stats propagation confirmation per §9.**

**C4. Exception visibility per §10.**

### Deferred, explicitly — not failed

CLV and closing-line display, live automated-grading status, and any provider-fed research or
line surface. They require live provider data. They are deferred by owner decision, and a
Command Center that renders them honestly as *unavailable* is correct today; one that renders a
plausible number is not.

### Not in scope for any of the above

`system_runs` retention and any new index (reserved decision 1). Dispatching a deploy (reserved
action 8). The Wave 3 contract, until someone decides to reconstruct or delete it.

---

## 6. What counts as verification here

- **A rendered page is not a working page.** `/review` rendered cleanly on 4 of 6 probes and
  failed on 2. Probe repeatedly, and report the distribution rather than the last result.
- **A returned count is not a true count.** The review queue's total was an honest read of the
  wrong population. Check what a number counts against what the page displays.
- **A query that succeeds can still answer nothing.** The `system_runs` read returned 26 rows and
  no error for months, every one a heartbeat, leaving every summary structurally empty.
- **A merged repair is not a running repair**, and the distinction expires daily. State which
  boundary a claim holds at: memory → staging DB → browser → production.
- **Never click a mutation control during an automated sweep.** Settle, approve, retry and requeue
  are one click away on these pages and they write to production.
- **An identical symptom is not an identical cause.** Seven routes rendering the same Postgres
  timeout string were four defects across five pages.

---

## 7. Applying this to the other products

The Pipeline intent (grading, settlement, CLV) is still unwritten and holds the same placeholder
this file held. It should be written when that product is next worked — and it should be written
the way this one was: disposition the existing documents first, measure second, and only then
say what to do.
