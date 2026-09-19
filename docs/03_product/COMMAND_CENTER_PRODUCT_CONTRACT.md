# Command Center Product Contract

## Metadata

| Field | Value |
|---|---|
| Status | Ratified |
| Authority | **Sole product authority for Command Center.** What Command Center is, what it must do, its operator workflows, information architecture, pages and surfaces, data and write boundaries, UX behaviour, and launch acceptance. |
| Owner | Product (Griff). Changes to launch scope, band assignment, or acceptance criteria are owner decisions. |
| Supersedes | Every document listed in Appendix B. None of them is product or operations authority for Command Center any longer. |
| Subordinate to | The architecture, security, delivery and readiness contracts indexed in `docs/mission/spec.md`. Where this contract and one of those disagree about a system boundary, **the system contract wins and this file is stale** — fix this file. |
| Readiness | This contract defines no readiness threshold. `docs/05_operations/T1_PRODUCTION_READINESS_CONTRACT.md` remains the only definition of production readiness. |

**Rule of use.** An engineer or agent asked "what should Command Center do?" answers from this file
alone. If the answer is not here, it is not a Command Center product requirement — propose an
amendment to this file rather than reviving a retired document or writing a new one.

**This file states intent and acceptance, never current state.** It carries no production counts, no
PR numbers, no commit SHAs and no runtime status, because every one of those is false within days of
being written. Current state is measured against the running system and recorded in the lane and
readiness artifacts, never here.

---

## 1. Product purpose and users

### 1.1 What Command Center is

Command Center is Unit Talk's **internal betting intelligence, research, decision-support and
operations platform**. It is the surface through which Unit Talk's own operators understand the
betting market, evaluate and decide, and run the live pick lifecycle end to end.

It has two horizons, and both are real:

- **At launch** it must be a reliable operator control plane for the complete pick lifecycle — pick
  visibility, capper visibility, Discord delivery truth, settlement and corrections, recaps,
  performance, exceptions and system health.
- **At maturity** it is explicitly intended to replace Unit Talk operator dependence on external betting-research platforms in the **Props.Cash / Outlier class** by combining market research, line comparison, player and matchup intelligence, historical analysis, decision support, Unit Talk proprietary capper/system intelligence and complete operational control in one product. The product should progressively reduce the need for an operator to leave Unit Talk in order to research, evaluate, submit, monitor, settle, analyse or improve a betting decision.

The second horizon is product intent, not decoration. Launch simplification must not remove the
architecture or the product intent that the mature platform needs (§2.4).

### 1.2 What Command Center is not

- It is **not** a member-facing surface. Nothing in it is designed to be shown to a paying member.
  Member-facing delivery is Discord, governed by the delivery contracts.
- It is **not** the canonical pick-submission surface. Smart Form is (§1.4).
- It is **not** a database writer (§6).
- It is **not** an agent console. Orchestrating lanes, dispatching work and reading proof bundles
  are not Command Center product functions.

### 1.3 Users

| User | Description | What they need from it |
|---|---|---|
| **Operator** | An internal Unit Talk person running the live system, including the owner acting as operator | Every band-1 capability, and each band-2 capability as it ships. This is the only role the product recognises at launch. |
| **Analyst / researcher** | The same person wearing a different hat: evaluating markets, players, lines and past performance before deciding | Band-2 analysis, and the band-3 Research workspace as it is built. |
| **Engineer on call** | Diagnosing a failure in the pipeline | §17 system health, §16 exceptions, §8 lifecycle trace. |

There is no member role, no capper self-service role and no read-only guest role in Command Center at
launch. A differentiated internal role model is band 2 (§7.4).

### 1.4 Relationship to Smart Form — a load-bearing boundary

**Smart Form is the canonical Human Capper pick-submission surface. Command Center operates and
observes the resulting pick lifecycle.**

Command Center must not reimplement pick creation. A pick-composition surface inside Command Center
that posts to the submission endpoint without carrying the full governed Smart Form payload produces
a pick that no governed surface can see — it is absent from the governed cohort, from capper
statistics, from delivery routing and from the operator's own pick list. That is a data-truth defect,
not a convenience.

Any future operator-side pick creation requires (a) a real, identified operator need that Smart Form
genuinely cannot serve, and (b) submission through the same governed contract Smart Form uses, with
the same required fields and the same provenance honesty. Absent both, the answer is Smart Form.

The existing legacy composition surface is retired product — see §4.4 and Appendix C.

### 1.5 The one-sentence north star

Command Center must let an operator, in the blink of an eye, determine which parts of the Unit Talk
lifecycle are working and which are not — and then, without leaving the product, research, decide,
act and verify the result.

The first clause is the launch bar. The second is the mature product.

---

## 2. Launch scope, non-goals, and the four capability bands

### 2.1 The bands

Every Command Center capability belongs to exactly one band. A capability with no band is not a
Command Center requirement.

| Band | Name | Meaning |
|---|---|---|
| **1** | **Launch Required** | Command Center is not launchable without it. An operator running the live product every day depends on it. Failing band 1 is a launch blocker. |
| **2** | **Post-Launch Core** | Genuine product, scheduled after launch. Its absence is friction an operator can work around; its presence is expected within the normal product roadmap. Architecture must not preclude it. |
| **3** | **Future Intelligence Platform** | The mature research/intelligence/decision product. Not launch-scoped and **not speculative** — it is the stated destination. Launch must not be delayed to reach it, and launch must not foreclose it. |
| **4** | **Data- or Provider-Blocked** | Specified, wanted, and not implementable until a data dependency resolves. Blocked is **deferred, not failed**, and a band-4 capability is never marked complete by rendering a plausible number. It renders its blocked state honestly (§18.5) or it does not render. |

### 2.2 Band assignment rules

1. **Exactly one current band, never two.** Every atomic capability in this contract carries one
   band and one only: 1, 2, 3 or 4. A compound assignment — "2 and 3", "3, partly 4", "4 (1 for the
   metric, 3 for the analysis)" — is not a band, it is an unresolved classification, and it makes
   launch-blocking status a matter of interpretation. Where a row genuinely described two different
   capabilities, the row is split so that each has its own band.
2. **A band-4 capability records its underlying priority as metadata, not as a second band.** Its
   current band is 4. What it becomes when the blocker clears is recorded in a separate **When
   unblocked** column, and that column is scheduling information — it never makes the capability
   launch-blocking today. A band-4 capability whose underlying priority is 1 is still not band 1:
   it cannot ship, and launch is not held for it.
3. **A capability is band 4 only when the blocker is data, not effort.** "Nobody has built it" is
   band 2 or 3. "The rows do not exist" is band 4.
4. **Band 1 is a ceiling, not a wish list.** A capability enters band 1 only if an operator running
   the live product cannot do their job without it.
5. **No band may be satisfied by a placeholder.** A cell rendering `—`, `N/A`, `0` or blank where
   real data belongs is a failure of that capability, not a partial pass (§5.4).

### 2.3 Explicit launch scope (band 1 summary)

At launch, an operator must be able to do all of the following inside Command Center, without
Supabase access, log files, terminal commands, an AI agent or a hand-constructed URL:

1. See whether the system is working, and where it is not (§17).
2. Find any pick, by identity or by property, and open it (§8).
3. Read a pick's complete lifecycle — submission, identity, provenance, scoring, promotion,
   distribution, delivery, settlement, corrections and audit — on one page (§8.3).
4. See the Human Capper lifecycle specifically: distribution mode, routing destination, delivery
   receipt, recap state (§9).
5. Settle a pick manually, truthfully, with recorded evidence (§10).
6. Correct a settlement without destroying the original (§11).
7. See whether a recap was posted, and if not, why (§12).
8. See delivery truth — outbox, receipts, failures, dead letters — and the kill-switch state for
   every governed target (§13).
9. See per-capper performance computed from the persisted history (§14).
10. See Unit Talk aggregate performance computed from the same history (§15).
11. Work operational exceptions to resolution (§16.3).
12. Understand every one of the above states from the words on screen, unambiguously (§19).

### 2.4 Non-goals at launch — and what that does and does not mean

The following are **not** band 1. Each row states its real band, because "non-goal at launch" has
been read in the past as "not part of the product", and that reading is what produced the document
sprawl this contract replaces.

| Not at launch | Band | When unblocked | Note |
|---|---|---|---|
| Research workspace as a whole | 3 | — | Core to the mature product. Its individual surfaces are catalogued and banded one by one in §4.5, and several of them are currently band 4. |
| Trend and split analysis, hit-rate histories | 4 | 3 | Needs a per-player, per-game historical stat store that does not exist. §4.5. |
| Multi-book market comparison, arbitrage, middling and line shopping | 4 | 3 | Needs multi-book provider data. §4.5, §4.6. |
| Portfolio, exposure and correlation intelligence | 3 | — | Not data-blocked; not built. §4.6. |
| Closing-line value, as a metric on a pick or a capper | 4 | 1 | Needs closing lines. Its underlying priority is 1 — it is part of the performance record the product will eventually claim — but it is blocked, so it does not block launch. §5.6, §14.3. |
| CLV distribution and comparative analysis | 4 | 3 | Needs closing lines, and is mature-platform analysis rather than a record field. §4.6. |
| Model/score calibration and weight-effectiveness analysis | 2 | — | Not data-blocked. It renders an insufficient-sample state until the gate in §5.3 is met; the gate governs what it may claim, not which band it is in. §4.6. |
| LLM-generated commentary anywhere | 2 | — | Permitted only under §20 when it exists at all. |
| System-pick approval workflow | 2 | — | Approval is for system-generated picks; it is reserved and parked. §16.4. |
| Capper and member administration | 2 | — | |
| Agent / lane / proof control surfaces | Out of product | — | Not a Command Center product function at any band. |
| Member-facing anything | Out of product | — | |

**The rule this table encodes:** a launch non-goal is a *scheduling* decision. It never authorises
removing an abstraction, a data field, a route namespace or a state model that a band-2 or band-3
capability needs. When a launch simplification would foreclose a later band, take the simplification
in the UI and keep the structure.

---

## 3. Information architecture and navigation

### 3.1 The four workspaces

Command Center is organised into exactly four canonical workspaces. They are distinct working
contexts, not steps in a flow: an operator stays inside one for an extended period and switches
deliberately.

| Workspace | The question it answers | Primary band |
|---|---|---|
| **Operations** | *Is the system working, and what needs my hand right now?* | 1 |
| **Decision** | *Should this pick go out, and why did the engine decide what it decided?* | 2 |
| **Intelligence** | *How well are we actually doing, and is our scoring telling the truth?* | 2 |
| **Research** | *What should we be betting, and where is the value?* | 3 |

Operations is the launch workspace. Decision begins in band 2 for the Human Capper-first launch; its information may still appear on a pick detail page when it exists, but a dedicated Decision workflow does not block launch. Intelligence and Research are where the mature product grows.

### 3.2 Navigation rules

1. **Exactly four canonical workspaces.** A new capability joins a workspace; it does not create a fifth workspace. A workspace does not have to appear as an active navigation destination until it contains at least one usable capability. Before that point it may be absent from navigation or clearly marked as future/unavailable, but it must never lead to a broken or fake surface. If a capability genuinely fits none of the four, that is an amendment to this section, not an ad-hoc nav entry.
2. **A persistent left sidebar workspace switcher**, visible on every page, with the product name
   anchored above it and the authenticated operator identity anchored below it. Primary navigation
   is never hidden behind a menu.
3. **Secondary navigation is scoped to the active workspace** and appears beneath the switcher.
   Cross-workspace links are ordinary in-page links, not nav items.
4. **The active workspace and the active page are both always visibly indicated.**
5. **A capability that is blocked (band 4) or not yet built may appear in secondary navigation only
   if selecting it lands on an honest blocked/empty state** (§18.5). A nav item that leads to a
   broken page is worse than no nav item.
6. **The product surface is always called "Command Center"** in navigation, headings and every
   operator-visible string. Internal package names are never surfaced (§19.1).

### 3.3 Cross-cutting surfaces

Three things are reachable from everywhere and belong to no single workspace:

- **Global search / jump to pick** — an operator who has a pick id, or a fragment of one, reaches
  the pick detail page from any page. Band 1.
- **Global health indicator** — a compact always-visible signal of whether the system is healthy,
  linking into Operations §17. Band 1. It must not cost a page a database round trip per request;
  see §5.7.
- **Authenticated operator identity** — who the system believes you are, matching the actor that
  will be recorded against any write you perform (§7.3). Band 1.

---

## 4. Canonical page and surface catalog

This is the authoritative list of what Command Center contains. A route that is not here is either
retired product or an undeclared addition; either way it needs reconciling against this section
rather than being left to accumulate.

**How to read the band column.** Every row carries exactly one band. `1` must exist and work at
launch. `2` is scheduled product. `3` is the mature platform. `4` is blocked on data. Where a table
contains band-4 rows it also carries a **When unblocked** column: that is the priority the capability
takes on once its data dependency resolves. It is metadata about scheduling, not a second band, and a
band-4 row is never launch-blocking however its underlying priority reads (§2.2 rules 1–2).

### 4.1 Cross-cutting

| Surface | Purpose | Band |
|---|---|---|
| Global health indicator | Persistent system-working / not-working signal | 1 |
| Jump to pick | Reach any pick's detail page from anywhere | 1 |
| Operator identity | The actor the system will attribute your writes to | 1 |

### 4.2 Operations workspace

| Surface | Purpose | Band |
|---|---|---|
| Operations home | The blink-of-an-eye view: health signals, what is stuck, what is waiting on a human, recent lifecycle activity | 1 |
| Picks list | Find picks by identity, capper, source, distribution mode, lifecycle state, date, market, sport | 1 |
| Pick detail | The complete lifecycle trace for one pick (§8.3) | 1 |
| Review queue | Picks awaiting an operator review decision, with the reason each is there (§16.1) | 2 |
| Held queue | Picks an operator has held, with what it would take to release each (§16.2) | 2 |
| Exceptions | Failures needing a human: delivery failures, dead letters, stalled lifecycle, orphaned rows (§16.3) | 1 |
| Delivery and Discord operations | Outbox, receipts, per-target delivery state, kill-switch state (§13) | 1 |
| Settlement | Manual settlement and correction entry points (§10, §11) | 1 |
| Recaps | Whether each settled pick's recap posted, and why not (§12) | 1 |
| System and runtime health | Component-level truth: API, worker, grading, ingestor, outbox, database (§17) | 1 |
| Intervention and audit log | Every operator action, attributed and timestamped | 1 |
| Scheduled and automated runs | What ran, when, with what result | 2 |
| Readiness scorecard | The production-readiness dimensions, measured | 2 |
| Capper and member administration | Onboarding, routing configuration, tier assignment | 2 |
| Governance and lane surfaces | — | Out of product |

### 4.3 Decision workspace

| Surface | Purpose | Band | When unblocked |
|---|---|---|---|
| Score breakdown | The engine's promotion score for a pick, component by component, with the weights that produced it (§5.3) | 2 | — |
| Suppression and qualification reasons | Why a pick was suppressed, not eligible, expired or qualified — in operator words, not enum values | 2 | — |
| Promotion preview | What the engine would decide for a pick right now, deterministically | 2 | — |
| Routing and board view | Which target a qualified pick is bound for, and the board it would join | 2 | — |
| Board queue | The composed board awaiting release | 2 | — |
| Decision overlays: middling, hedging, board fit | Positional decision support across a board | 4 | 3 |
| Approval workflow for system-generated picks | Operator accept/reject of machine picks. Parked under §16.4 — parked is an activation state, not a band. | 2 | — |

### 4.4 Execution surfaces — retired

There is **no operator pick-composition surface** in Command Center. Pick creation belongs to Smart
Form (§1.4). Any existing composition route is retired product and must be removed or made
unreachable; it must not be extended, and it must not be treated as a specification for a future one.

Operator *actions on existing picks* — settle, correct, review, hold, release, retry, requeue,
intervene — are not pick composition and are band 1. They live in Operations.

### 4.5 Research workspace

| Surface | Purpose | Band | When unblocked |
|---|---|---|---|
| Prop and offer explorer | Browse the available market — offers, lines, books. Needs provider-fed offers. | 4 | 3 |
| Player card: identity and current lines | Who a player is and what is currently offered on them. Needs provider-fed offers. | 4 | 3 |
| Player card: historical performance and hit rates | How a player has actually performed against lines. Needs a per-player, per-game stat history that does not exist. | 4 | 3 |
| Matchup: event identity and context | The game, its participants, its situation | 3 | — |
| Matchup: comparative and situational stats | Team and matchup analytics. Needs a historical stat store. | 4 | 3 |
| Trend and split filters | Home/away, rest, pace, opponent-adjusted splits. Needs a historical stat store. | 4 | 3 |
| Line shopping and book comparison | The same market across books, with a sharp reference. Needs multi-book data. | 4 | 3 |
| Saved research, watchlists and notes | An operator's own working set | 3 | — |

**Research is band 3, not "cancelled".** Its data dependencies are named in band 4 precisely so that
when provider data arrives the work is specified rather than restarted.

### 4.6 Intelligence workspace

| Surface | Purpose | Band | When unblocked |
|---|---|---|---|
| Aggregate performance record | Unit Talk record, units staked and returned, and flat-bet ROI over the governed cohort, computed from the settlement plane (§15.1) | 1 | — |
| Per-capper performance record | Per-capper record, units, ROI and volume, each carrying its volume gate (§14) | 1 | — |
| Performance by selectable window | The same measures over arbitrary operator-chosen windows, and comparison between windows (§15.1) | 2 | — |
| Per-capper segmentation and comparison | One capper broken down by sport, market and window, and cappers compared against each other (§14.3) | 2 | — |
| Segment analysis | Performance by sport, market, source, distribution mode, score band | 2 | — |
| Score-to-outcome calibration | Whether the engine's scores predict outcomes, with an explicit confidence level. Renders an insufficient-sample state until the §5.3 gate is met. | 2 | — |
| Attribution | Which decisions and which components produced the result | 2 | — |
| Closing-line value metric | CLV on a pick and on a capper, as a field of the performance record. Needs closing lines. | 4 | 1 |
| CLV distribution and comparative analysis | CLV by capper, by market and as a distribution. Needs closing lines. | 4 | 3 |
| Market and line-movement intelligence | Steam, sharp action, movement classification. Needs multi-book provider data. | 4 | 3 |
| Portfolio, exposure and correlation | Concentration and correlated risk across open positions | 3 | — |
| Alerts and signal feed | Operator-configurable notification on any of the above | 3 | — |

### 4.7 Route-namespace rule

Each workspace owns a route namespace, and a page lives under the workspace that owns its question.
The same subject matter may be reachable from more than one workspace by link, but it is *defined*
in exactly one place and implemented once. Duplicate implementations of the same view under two
namespaces are a defect, not a convenience — they drift, and the operator cannot tell which one is
telling the truth.

A route that only redirects to another route is not a surface. It is either removed or it becomes a
real page.

---

## 5. Data-truth rules

These rules apply to every band and every surface. They are the reason the product is trustworthy;
violating one is a correctness defect, not a polish item.

### 5.1 Everything displayed comes from the correct canonical authority

Nothing is hardcoded, sampled, simulated, estimated, remembered from a previous render, or generated. There are no demo values, no seeded examples and no "representative" figures anywhere in the product, including in surfaces that are not yet finished.

| Truth being displayed | Canonical authority |
|---|---|
| Picks, cappers, settlements, delivery records, audit records and persisted performance | Canonical production database |
| Runtime process health and component liveness | Direct runtime / health evidence from the running system |
| Runtime configuration and containment posture | Running deployment / process configuration evidence |
| Deployment and release identity | Deployment metadata corroborated by the running release |
| Provider / market / research facts | Canonically ingested provider data with provenance |
| Operator mutations and their result | Canonical API response plus persisted write / audit evidence |

A surface reads each fact from the authority that actually owns it. Forcing runtime truth through Postgres is as incorrect as inventing a pick state in the UI.

### 5.2 A displayed value carries its provenance when provenance is contestable

Where the same fact can come from more than one source, the surface says which one it came from. In
particular:

- **A settlement** shows its source (operator-attested versus automated), its confidence, and its
  evidence reference.
- **An edge or market figure** shows the basis it was derived from. A fallback basis must never be
  presented as a market-backed one — a metric that counts a fallback as market-backed inverts its own
  verdict.
- **A pick's canonical identity** shows whether it resolved through the canonical catalog or through
  an honest coverage-gap path.

### 5.3 Engine decisions are shown as the engine made them

The promotion score is displayed component by component, with the weight applied to each component
and the threshold it was measured against, so an operator can reconstruct the total. Component
values, weights and thresholds come from the recorded decision, not from a re-computation in the UI —
a re-computation drifts from the decision that actually governed the pick.

The full recorded decision snapshot is audit data. It is available on demand and is never dumped raw
into the operator's reading path.

Calibration and weight-effectiveness analysis carries an explicit confidence level derived from
sample size, and does not present a suggested adjustment below a medium confidence level.

### 5.4 No placeholder where real data belongs

A cell rendering `—`, `N/A`, `0`, `null` or blank in place of a value the system actually holds is a
failing surface. This is distinct from an honest empty state (§18.4), which says *there is no such
data* and is correct.

The test: if the value exists in the database and the screen does not show it, the surface fails.

### 5.5 Volume gates are mandatory on every rate

Any rate, percentage, average or ratio is displayed with its sample size, always, and is suppressed
or explicitly marked unreliable below the threshold its metric defines. A percentage without an `N`
beside it is a defect. A percentage computed from a sample too small to mean anything, displayed as
if it means something, is a worse defect.

### 5.6 A blocked metric renders its blocked state, never a substitute

Where a metric cannot be computed because its input does not exist — closing-line value being the
standing example — the surface says so plainly and says what it is waiting on. It does not render
zero, it does not hide the row, and it does not substitute a different metric under the blocked
metric's name.

### 5.7 Reads are scoped to what the surface shows

A page reads what it renders. It does not read the whole table to display fifty rows, it does not
run a global aggregate to display a badge, and a shared layout does not run per-page reads on every
request in the application including requests that render nothing.

This is a product rule, not only a performance one: an operator surface that times out is an
operator surface that does not exist, and the failure mode of an unbounded read is a page that works
until the data grows and then silently stops.

### 5.8 Identify governed populations positively

Operator-submitted picks are identified by a positive predicate on what they actually carry, never
by a proxy such as capper name, source, or a view built for a different purpose. A proxy predicate
that silently includes fixtures or excludes real submissions produces confidently wrong statistics.
The canonical predicate is defined by the pick metadata contract and is the one every Command Center
surface uses.

### 5.9 Three state models, kept separate

Lifecycle state, delivery state and settlement state are independent (§19.2). A surface never
collapses them into one column, never derives one from another, and never infers a state it was not
given. A pick that is settled is not thereby delivered; a pick that is delivered is not thereby
settled.

---

## 6. Read and write boundaries

### 6.1 The rule

**Command Center reads persisted business truth through its server-side data layer, may read live runtime truth through explicitly approved authenticated runtime/API readers, and never writes to the database directly. Every write goes through the API, which is the single canonical writer.**

The boundary is load-bearing: persisted business reads use the canonical data layer; runtime truth uses the running system where the database is not authoritative; browser code receives neither privileged database credentials nor operator API credentials; and every mutation crosses the canonical API writer.

### 6.2 Reads

- All reads go through the app's own server-side data layer. A page does not open its own database
  connection, and no read happens in a browser.
- Read credentials are server-side only and never reach the client.
- The data layer is the single place a Command Center read may be added. A new read extends it; it
  does not bypass it.
- Persisted business-data reads do not go through a generic internal read-backend service. They read the canonical database through the Command Center server-side data layer.
- Runtime truth and health are the explicit exception: where the running process or deployment is the authority, Command Center may use approved authenticated server-side readers against the canonical runtime/API endpoints. These reads remain inside the sanctioned data/runtime layer and never expose privileged credentials to the browser.
- `apps/operator-web` is not a Command Center backend and is not reintroduced by this exception; Appendix A contradiction 1 remains retired as an architecture.

### 6.3 Writes

- Every mutation — settle, correct, review, hold, release, retry, requeue, intervene, toggle a kill
  switch — is performed by the API, invoked by Command Center over authenticated HTTP.
- Command Center carries no business logic. It does not compute a score, decide a promotion, derive a
  settlement outcome, or determine delivery eligibility. It presents what the system decided and
  submits what the operator chose.
- A new operator action requires a corresponding API endpoint. A write surface with no endpoint
  behind it is not built.
- Every write request carries operator credentials and is attributed to the actor those credentials
  prove (§7.3).

### 6.4 What this boundary buys

The write path has one gatekeeper, so every invariant the system enforces — fail-closed delivery,
canonical identity, distribution-mode containment, audit completeness — is enforced once, in one
place, for every caller. A Command Center write that bypassed it would silently exempt the operator
surface from the protections the rest of the system runs under.

**This boundary is not negotiable for operator convenience.** If an operator action is awkward
because the endpoint does not exist, the answer is the endpoint.

---

## 7. Authentication and authorization

### 7.1 Fail closed, on every path

- Every route requires valid credentials. The set of public paths is an explicit, literal allowlist —
  static build output and an unauthenticated health endpoint — and nothing else.
- Path *shape* is never an authentication boundary. A route must not become public by containing a
  dot, an extension, a particular segment or any other incidental property of its URL. Every new
  route inherits authentication by default and can only be exempted by being named in the allowlist.
- Missing or misconfigured authentication configuration is a refusal, not a bypass. A deployment that
  cannot determine whether authentication is required serves nothing.

### 7.2 Credentials

Credentials are carried by the request itself. Identity is never taken from a header that the request
could set for itself, and never from a query parameter, a cookie set by the client, or an environment
variable interpreted as "who is using this".

### 7.3 Actor attribution

Every privileged action is attributed to the actor proven by the request's own credentials, and that
actor is what is recorded against the resulting database row and audit entry. The operator can see
that identity on screen before acting (§4.1), so what they see and what is recorded cannot diverge.

**A development bypass is never an operator.** Where an unauthenticated local-development mode
exists, requests admitted by it are logged as what they are — unauthenticated requests admitted by a
development bypass — and never recorded as a privileged action by a named actor. A fabricated actor
in the audit stream is indistinguishable, afterwards, from a real one.

### 7.4 Roles

Launch recognises a single role: **operator**. Every authenticated user can do everything.

A differentiated internal role model — read-only observer, settlement authority, delivery authority,
administrator — is band 2. Until it exists, this contract does not pretend it does: no surface
displays a role-based affordance that is not enforced, and no document claims role separation the
system does not implement.

### 7.5 Reserved actions remain reserved

Authentication to Command Center authorises operating the system. It does not authorise the actions
the mission reserves to the owner — production DDL and data deletion, member-delivery activation,
provider or subscription commitments, secrets, pricing, containment changes, merge-authority changes,
and dispatching a production deployment.

Where Command Center surfaces a control that touches a reserved action — the delivery kill switch
being the live example — the control operates the mechanism, and the *posture decision* remains the
owner's. Command Center must make the current posture unmistakable (§13.3); it must never present
changing it as a routine operator action.

---

## 8. Pick discovery and lifecycle detail

### 8.1 Discovery

An operator finds a pick by identity or by property. At launch the properties are: capper, source,
distribution mode, lifecycle state, settlement state, delivery state, date range, sport, market.

Search results state their own total honestly. A displayed count that was computed over a different
population than the rows shown is a data-truth defect — an operator sizing a queue from it makes a
wrong decision. The count and the rows answer the same question or the count is not displayed.

Results are paginated, ordered most-recent-first by default, and every row links to the pick detail
page.

### 8.2 Fixture and test data are never presented as real

Populations that include non-production rows — CI fixtures, seeded proof data, historical test
submissions — are excluded from operator surfaces by the same predicate that produces the count
(§5.8). Filtering rows after counting them is the specific defect this rule exists to prevent.

### 8.3 Pick detail — the complete lifecycle trace

The pick detail page is the single place an operator reconstructs what happened to a pick. It shows,
on one page, in lifecycle order:

| Section | Contents | Band |
|---|---|---|
| **Identity** | Pick id, capper, source, submission surface, created time, canonical event and participant identity, and whether that identity resolved canonically or through an honest coverage gap | 1 |
| **Selection** | Market, selection, line, odds, stake, conviction, thesis | 1 |
| **Submission trace** | The submission events recorded for it, in order, including any validation refusal and its reason | 1 |
| **Scoring and promotion** | The engine's score components and weights, the qualification outcome, the target, and the suppression or ineligibility reason in operator words (§5.3) | 1 |
| **Distribution** | Distribution mode, whether a delivery was enqueued, the target, the routing basis, attempt count, and the outcome of each attempt | 1 |
| **Delivery receipt** | The receipt for a delivered pick: destination, destination source, message reference, timestamp | 1 |
| **Settlement** | Every settlement record for the pick, including superseded ones, each with source, confidence, evidence reference, actor and time (§10, §11) | 1 |
| **Recap** | Whether a recap posted for this pick, and if not, the reason (§12) | 1 |
| **Audit** | Every operator action taken on this pick, attributed and timestamped | 1 |
| **Review history** | Every review decision, with reason and actor | 1 |

A section with no data shows an honest empty state (§18.4) — it is never omitted silently, because
the absence of a section reads as "this stage did not apply" when it may mean "this stage failed".

**Band 1 here is not in tension with band 2 in §4.3 and §16.** A fact belongs on pick detail at launch
whenever the system already holds it; the *dedicated workflow* built around that fact — the Decision
workspace's score breakdown and suppression analysis, the review queue, the held queue — is band 2 and
does not block launch. Showing a recorded scoring outcome or review decision on the pick is display of
existing truth, not the workflow.

### 8.4 The invisibility test

A pick's page passes when an operator, reading only that page, can answer: where is this pick in its
lifecycle, what decided that, did it go anywhere, did it settle, was that settlement honest, who
touched it, and if it is stuck — exactly where and why.

---

## 9. Human Capper lifecycle visibility

The Human Capper path is Unit Talk's live pick lifecycle and the product's primary use. Command
Center must make its specifics visible, not merely representable as a generic pick.

### 9.1 What must be visible, per pick

| Fact | Why it matters | Band |
|---|---|---|
| **Distribution mode** — track-only versus delivery-eligible | It is the single field that determines whether a pick can reach a member. It appears on every pick surface, never only in a detail pane. | 1 |
| **Capper canonical identity** | Attribution and per-capper statistics depend on the canonical identity column, not on a metadata copy of it | 1 |
| **Provenance honesty** | Whether canonical identity resolved or the pick took the declared coverage-gap path | 1 |
| **Routing destination and basis** | Which channel a delivery-eligible pick is bound for, and which configured field produced that destination | 1 |
| **Delivery outcome** | Enqueued, attempted, delivered, failed, dead-lettered — with attempt count | 1 |
| **Refusal reason** | When a delivery-eligible pick did not deliver, the reason: the kill switch, a routing failure, a validation refusal, a containment rule | 1 |
| **Recap state** | Posted, not posted with a reason, or not applicable | 1 |
| **Settlement route** | Operator-attested or automated, with evidence | 1 |

### 9.2 Track Only must be visibly, provably inert

For a track-only pick, Command Center shows that no delivery exists — affirmatively, as a verified
absence, not as an empty section. "No outbox row, no receipt, no delivery attempt" is the display,
because that is the claim the containment design makes and the operator surface is where it is
checked.

### 9.3 A killed target is not Track Only

When a delivery-eligible pick does not deliver because its target's kill switch is engaged, the pick
is **delivery-eligible and delivery-refused**. It is never displayed, described or recorded as track
only. The two states have different meanings, different causes and different remedies, and
collapsing them hides an operational fact behind a product one.

### 9.4 Capper visibility, in aggregate

An operator can see, per capper: their submissions, their distribution-mode split, their routing
configuration, their delivery history, their settlement record, and their performance (§14).

---

## 10. Manual settlement

### 10.1 Purpose

Manual settlement is how an operator records a real outcome that the automated path has not produced.
It is not a fallback of last resort and it is not a lesser route — for as long as automated grading
lacks a trusted result supply, it is the *primary* settlement route, and the product treats it as a
first-class operator workflow rather than a repair tool.

### 10.2 What a manual settlement requires

Every manually entered settlement records, without exception:

| Field | Rule |
|---|---|
| Outcome | Win, loss, push, void — the canonical outcome vocabulary, no free text |
| Source | Recorded as operator-attested. It is never recorded as automated. |
| Confidence | The operator's stated confidence in the outcome |
| Evidence reference | A real, checkable reference to where the outcome was observed. Required; a settlement with no evidence reference is refused, not warned about. |
| Actor | The authenticated operator (§7.3) |
| Time | Server time of the write |

### 10.3 Behaviour

- The form refuses an outcome that the pick's own shape cannot take.
- Settling an already-settled pick is refused; the path for changing a settled outcome is a
  correction (§11), not a second settlement.
- The surface states, before the operator acts, whether the pick is already settled — derived from
  the settlement plane, never assumed.
- On success the operator sees the resulting settlement record, with its attribution, on the pick.
- The operator is never required to know a pick's internal identifier to settle it; they reach the
  form from the pick.

### 10.4 What manual settlement must not do

It must not mark a pick settled without a settlement record. It must not invent an outcome for an
event that did not occur — an unsettled pick for a cancelled match is the correct state, and the
product must let it stay that way. It must not be used to make a statistic look complete.

---

## 11. Corrections

### 11.1 The rule

**A correction supersedes; it never overwrites.** The original settlement record is preserved
verbatim, and the correcting record references it. The settlement history of a pick is append-only.

### 11.2 Behaviour

- A correction requires a reason, and the reason is stored and displayed.
- A correction carries the same required fields as a settlement (§10.2), plus its reference to the
  record it corrects.
- The pick detail page shows the full chain: original, each correction, and which record is currently
  in effect — with the superseded ones visibly superseded rather than hidden.
- Statistics (§14, §15) are computed from records in effect. They never silently include superseded
  records, and they never silently exclude the fact that a correction happened.

### 11.3 Why this matters to the product

The performance record is the product's claim about itself. A record that can be edited in place is
a record that cannot be audited, and a capper history that quietly changed is worth nothing to the
member it is eventually shown to.

---

## 12. Recap visibility

### 12.1 What must be visible

For every settled pick that was delivered, Command Center shows one of exactly three states:

| State | Meaning |
|---|---|
| **Posted** | A recap was published, with its destination and time |
| **Not posted** | With the specific reason: routing could not resolve, the target's kill switch refused it, the attempt failed, or it has not been attempted |
| **Not applicable** | The pick was never delivered, so no recap is owed |

A blank recap section, or a settled delivered pick with no recap state at all, is a failing surface.
Silence is the failure mode this section exists to eliminate: a pick that settles correctly and
recaps silently not at all looks identical, from every other surface, to one that worked.

### 12.2 Aggregate recap health

An operator can see, across a window, how many settled delivered picks recapped and how many did not,
with the reasons grouped. Band 1 — this is the surface that turns a single silent failure into a
visible pattern.

### 12.3 Scheduled recaps

Digest and scheduled recaps are shown in the same terms: whether the scheduled run happened, what it
posted, and where it failed. Band 2.

---

## 13. Discord and delivery operations

### 13.1 Delivery truth

Command Center is where an operator establishes what was actually delivered. It shows, at launch:

- The outbox: rows by state, with age, target and attempt count, and what is stuck.
- Receipts: what was delivered, where, when, and on what routing basis.
- Failures and dead letters: which pick, which target, how many attempts, the failure reason, and the
  action available.
- Per-target delivery history and current health.

A row that no worker configuration could ever claim is classified as such and reported separately. It
is neither counted as healthy work in progress nor counted as a stale failure — both readings are
wrong, and a control that answers the same way for every row conveys no information.

### 13.2 The routing configuration is visible

An operator can see, for each capper and each target, which configured destination delivery will use
and which field supplied it. Official pick delivery reads exactly one configured field; a discussion
or secondary channel is never an official pick destination, and the surface makes the distinction
explicit rather than presenting a list of interchangeable channels.

Destinations are read from configuration and displayed as configured. No destination is hardcoded
anywhere in the product.

### 13.3 Kill-switch behaviour

| Rule | Detail |
|---|---|
| **Current state is always visible** | For every governed target, engaged or not, with who changed it, when, and the recorded reason. Never inferred, never cached, never assumed. |
| **Fail closed** | A target with no kill-switch record is treated as killed. The display shows this as killed, not as unknown or as open. |
| **A toggle is an operator action with a required reason** | The reason is stored and shown in the history. |
| **Engaging is routine; disengaging is a posture decision** | Engaging a kill switch is always available. Disengaging one on a member-facing target is a member-delivery posture action reserved to the owner (§7.5). The surface states this at the point of action rather than discovering it afterwards. |
| **The switch is not a substitute for containment** | Distribution mode governs whether a pick may deliver at all; the kill switch governs whether a target accepts anything. Both are shown, and neither is described in the other's terms (§9.3). |

### 13.4 Operator delivery actions

Retry a failed delivery, requeue a pick, and resolve a dead letter — each through the API, each
attributed, each recorded, and each refused when the pick's own distribution mode forbids delivery.
An operator action can never move a track-only pick into delivery: the refusal comes from the system,
and Command Center displays it rather than pre-empting or bypassing it.

### 13.5 Never test against a real member destination

Command Center provides no capability to post arbitrary or test content to a member-facing channel.
Delivery verification uses the designated internal verification target. This is a product rule
because the product is where the capability would otherwise be built.

---

## 14. Capper performance

### 14.1 What it shows

Per capper, computed from the persisted settlement history and reconciling against the underlying
rows:

- Record: wins, losses, pushes, voids, and the count of unsettled picks
- Units staked and units returned; flat-bet ROI
- Volume and submission cadence
- Distribution-mode split
- Segmentation by sport, market and time window
- Closing-line value

### 14.2 Rules

- Every rate carries its sample size and its volume gate (§5.5).
- Attribution uses the canonical capper identity column, not a metadata copy. Two attribution paths
  produce two different leaderboards and one of them is wrong.
- Unsettled picks are shown as unsettled, never counted as anything else.
- Statistics are read from the settlement plane, not recomputed ad hoc per surface. Two surfaces
  showing two different records for the same capper is a defect regardless of which is right.

### 14.3 Bands

Capper performance is not one capability, and it does not carry one band. Each measure above is
banded on its own:

| Capability | Band | When unblocked |
|---|---|---|
| Record — wins, losses, pushes, voids, unsettled count | 1 | — |
| Units staked, units returned, flat-bet ROI | 1 | — |
| Volume, submission cadence, and the volume gate on every rate (§5.5) | 1 | — |
| Distribution-mode split | 1 | — |
| Segmentation by sport, market and time window | 2 | — |
| Comparison of one capper against another | 2 | — |
| Closing-line value on a capper | 4 | 1 |

The first four are band 1 for the Human Capper path, because a performance history no operator can
read is a history the product cannot later claim. Closing-line value belongs to that same record —
that is why its underlying priority is 1 — but it is blocked on closing lines, so its current band is
4 and launch does not wait for it (§5.6, §2.2 rule 2).

---

## 15. Unit Talk aggregate performance

### 15.1 What it shows

The same measures as §14, across the whole governed population rather than one capper, plus:

- Performance by distribution mode, source, sport, market and score band
- Performance over selectable windows
- Comparison of engine-qualified versus operator-decided outcomes
- Trend over time

Banded one capability at a time, on the same rule as §14.3:

| Capability | Band | When unblocked |
|---|---|---|
| Aggregate record, units staked and returned, flat-bet ROI over the governed cohort | 1 | — |
| Performance by distribution mode, source, sport, market and score band | 2 | — |
| Performance over selectable windows, and comparison between windows | 2 | — |
| Engine-qualified versus operator-decided outcome comparison | 2 | — |
| Trend over time | 2 | — |
| Market-relative measures — CLV and closing-line-derived aggregates | 4 | 3 |

The first row is band 1 for the same reason as §14.3. Nothing else here is.

### 15.2 Rules

- The aggregate reconciles against the sum of its parts. If per-capper figures do not sum to the
  aggregate, the surface is wrong and says nothing rather than showing both.
- The population is the governed population, identified positively (§5.8). Fixtures and test rows are
  never inside it.
- A window with insufficient settled volume reports insufficient volume. It does not report a
  percentage.

---

## 16. Review, held and exception workflows

### 16.1 Review queue — Band 2

The review queue holds picks awaiting an operator decision. Each row states **why it is there** — the
suppression or hold reason in operator words, not an enum — so the queue is actionable without
opening every row.

Rules:

- The queue's count and its rows describe the same population (§8.1).
- A decision requires a reason; the reason is stored and appears in the pick's review history.
- Decisions are: approve, deny, hold. Each is attributed and recorded.
- Bulk action is permitted only where the reason applies identically to every selected row, and the
  operator sees exactly what will change before confirming.

### 16.2 Held queue — Band 2

Held picks are picks an operator deliberately parked. The surface shows, per pick, who held it, when,
why, and what would release it — a held pick with no release condition is a pick that will be
forgotten.

Held is an operator state. It is not a lifecycle state and not a delivery state (§5.9).

### 16.3 Exceptions — Band 1

Exceptions are conditions that need a human and will not resolve themselves. At launch, at minimum:

| Category | What it is |
|---|---|
| Delivery failures | Attempted and failed, below the dead-letter threshold |
| Dead letters | Exhausted retries |
| Stalled lifecycle | A pick that has sat in a transitional state past its expected window |
| Unclaimed queue rows | Rows no worker configuration could claim |
| Settlement gaps | Picks whose event has concluded and which carry no settlement |
| Recap failures | Settled delivered picks with no recap and a reason (§12) |

Each exception states the pick, the condition, the elapsed time, the cause where known, and the
actions available. Each action goes through the API and is attributed.

**An exception category that would report the same answer for every row is not a control.** If every
row looks identical to the classifier, the classifier is not asking the question that distinguishes
them, and the category must be repaired rather than tuned.

### 16.4 Approval — scope and parking

Approval is a decision about **system-generated picks**: whether a machine-produced pick may proceed.
It is not part of the Human Capper path. A human capper's submission never enters an approval state
merely because it is delivery-eligible — a capper submitting a pick has already made the decision
that approval exists to make.

The approval workflow is band 2 and is parked for as long as system pick generation is parked. The
surface may show the state; it does not invent a workflow for a population that does not exist.

---

## 17. System and runtime health

### 17.1 The signals

Command Center answers "is the system working?" from component-level truth, at launch:

| Signal | Answers |
|---|---|
| Submission intake | Are picks arriving and persisting? |
| Promotion / scoring | Is the engine evaluating what arrives? |
| Delivery | Is the worker running, claiming and delivering? |
| Settlement | Are settlements being recorded, and by which route? |
| Recap | Are recaps posting? |
| Grading | Is grading running, and is it finding anything to grade? |
| Data supply | Are events, participants and results current enough to operate on? |
| Database and API | Are the system's own dependencies responding? |

### 17.2 Rules

- **Every signal states its detection basis.** What was measured, over what window, and against what
  threshold. A signal an operator cannot interrogate is a signal they cannot trust.
- **Three states, and they are distinguishable:** working, degraded, broken. Degraded is a real state
  and must not be rendered as either of the others.
- **Unknown is not healthy.** A signal whose evidence could not be read reports unknown, and unknown
  is treated as a failure for gating purposes, never as a pass.
- **No hardcoded, sampled or optimistic signals.** Ever.
- **A measurement window is stated and honoured.** A metric whose threshold names a seven-day window
  and which silently measured four hours is wrong in a way no reader can see. The surface shows the
  window actually covered alongside the aggregate.
- **Containment is displayed as containment, not as failure.** A component that is intentionally off
  reports "off by configuration", with the configuration that made it so — never "down". These route
  an operator to completely different actions.
- **Absence is distinguished from silence.** "This ran and found nothing" and "this did not run" are
  different, and a surface that renders them identically hides outages. Where a process examines a
  population and acts on none of it, the surface shows both numbers.

### 17.3 Runtime posture

An operator can see the effective runtime posture — which components are enabled, which are
intentionally parked, and which delivery targets are open — read from the running configuration
rather than from a document. Posture is displayed; changing it is reserved (§7.5).

---

## 18. Loading, empty, degraded and error states

Every surface in Command Center has all five states designed, not only the populated one. An
undesigned state is the state an operator meets on the worst day.

### 18.1 Loading

- Every navigation gives immediate feedback. A route transition that leaves the previous page on
  screen with no pending indicator reads as a dead click, and an operator who thinks the product is
  broken behaves as if it is.
- Every route has a transition boundary. Not two of them — every one.
- A slow section does not block the page. Fast sections render; slow sections show their own pending
  state in place.

### 18.2 Populated

Covered by §5.

### 18.3 Degraded

When part of a page's data is unavailable, the rest of the page renders. The unavailable part says
what is missing and why, in place. A single failed read never blanks a page, and never replaces
working data with an error.

### 18.4 Empty

An empty state says *what would be here*, *why there is nothing*, and *what would produce something*.
"No data" alone is not an empty state. An empty state is never filled with example, placeholder or
generated content to look populated.

### 18.5 Blocked (band 4)

A blocked capability renders a blocked state: what it will show, what it is waiting on, and that it
is deferred rather than broken. This is distinct from empty — empty means the query returned nothing;
blocked means the capability cannot yet be computed at all.

### 18.6 Error

- Errors are shown in operator language with the action available, not as raw engine text. A rendered
  database error message is a failure of this section.
- An error never silently succeeds. A refused write says it was refused and why.
- An error in a non-essential section never propagates to the canonical data on the same page.

---

## 19. Canonical language and state terminology

### 19.1 Product naming

The operator-visible surface is always **Command Center**. Internal package and directory names,
route namespaces and type names are implementation identifiers and never appear in the product. The
word *operator* remains correct as a role noun.

### 19.2 The three independent state models

These are separate vocabularies over separate populations and must never be conflated, collapsed or
used as synonyms.

| Model | Answers | Nature |
|---|---|---|
| **Lifecycle** | Where is this pick in its own life — submitted, validated, queued, posted, settled, voided? | The pick's own state |
| **Delivery** | Did it go anywhere — not promoted, queued, delivered, failed, dead-lettered? | The distribution attempt's state |
| **Settlement** | What was the outcome, and how sure are we — pending, settled, corrected, under manual review? | The outcome record's state |

Review state (pending, approved, denied, held) is a fourth, and is an operator decision record — not
a lifecycle state.

### 19.3 Words that are not synonyms

| These two | Are not the same because |
|---|---|
| **Qualified** and **Approved** | Qualified is the engine's decision that a pick meets the promotion bar. Approved is an operator's decision to let a pick proceed. Either can happen without the other. |
| **Track only** and **delivery refused** | Track only is the pick's own distribution mode, fixed at submission. Delivery refused is a target-side condition at delivery time. §9.3. |
| **Settled** and **graded** | Settled is an outcome record existing. Graded is the automated path having produced one. An operator-attested settlement is settled and not graded. |
| **Delivered** and **posted** | Delivered means a receipt exists for a distribution attempt. Posted is a lifecycle state. §5.9. |
| **Degraded** and **down** | A degraded component is working and impaired. §17.2. |
| **Off by configuration** and **failed** | §17.2. |
| **Blocked** and **failed** | A band-4 capability is deferred pending data. §2.1. |
| **No data** and **not measured** | An empty result and an unread evidence source route to different actions. §17.2. |

### 19.4 Enum values are translated, never displayed raw

An operator reads reasons and states in words. Internal enum values, error codes and column names
appear only where an operator would use them to file or trace an issue, and then alongside the
translation, never instead of it.

---

## 20. LLM usage restrictions

LLM-generated content is band 2. Nothing in Command Center depends on it, and nothing in this
contract requires it. These restrictions apply whenever it exists.

### 20.1 The principle

**An LLM wraps real data. An LLM never replaces real data, and never produces a number.**

### 20.2 Permitted

Narrative summary of data that has already been fetched and rendered on the same surface:

- A plain-language reading of figures already displayed
- A plain-language explanation of a score breakdown already displayed in canonical form
- A summary of an exception or intervention chain already displayed from the audit record
- A description of what an already-rendered analysis shows

In every case the canonical data renders first, unconditionally, and the commentary renders below it.

### 20.3 Prohibited, absolutely

- Generating, estimating or inferring any score, record, rate, ROI, closing-line value or outcome
- Describing a lifecycle, delivery, settlement, approval or promotion state, or paraphrasing one in
  terms that differ from the canonical vocabulary (§19)
- Producing trend, correlation or calibration claims not already computed deterministically
- Projecting future performance in any form
- Filling an empty, degraded or blocked state with generated text (§18.4, §18.5)
- Displaying a model refusal or error to an operator
- Any commentary on a band-4 metric whose underlying data does not exist

### 20.4 Fail closed and never on the critical path

Every page containing commentary is fully functional without it. The request is non-blocking and
parallel, never sequential with the canonical read. On unavailability, timeout, error, empty response
or refusal, the commentary section is hidden silently and the page renders completely.

An LLM dependency is wrapped in a circuit breaker that suppresses requests after repeated failure,
recovers by probe, and is observable in system health (§17). LLM failure never propagates to any
other application or to any write path.

---

## 21. Usability and form factor

### 21.1 Desktop-first, and honest about it

Command Center is a desktop operator tool. It is designed for a wide display, and dense data tables
are correct for it. There is no obligation to make every analytical surface work at phone width.

### 21.2 What must work on a phone

Some operator work is genuinely mobile — checking whether the system is healthy, seeing whether a
delivery went out, reading a pick, settling one from wherever the operator is when a game ends.
These are band 1 on a phone:

| Surface | Requirement |
|---|---|
| Global health | Readable and accurate at phone width |
| Pick lookup and pick detail | Readable, scrollable, no horizontal page scroll |
| Settlement and correction forms | Usable: inputs reachable, labels visible, buttons tappable, no layout trap |
| Delivery and kill-switch state | Readable |
| Exceptions | Readable, with actions reachable |

Everything else degrades gracefully: it may be cramped, it may require horizontal scroll inside a
table, but it must not be unreachable or unreadable, and navigation must remain usable.

### 21.3 Baseline usability rules

- Navigation is reachable from every page without the browser back button.
- No operator workflow requires constructing a URL by hand, knowing an internal identifier, or
  copying a value between two surfaces.
- Destructive or hard-to-reverse actions confirm, and state what will happen.
- Every form states its validation failure next to the field that failed.
- Data tables sort and paginate; a table that can only be read from the top is not usable at real
  volume.
- Signed values — odds, units, line movement — display their sign unambiguously on every surface and
  at every width.

---

## 22. Golden-path production acceptance criteria

Command Center is accepted for launch when an operator, using only Command Center against the live
system, completes every step below without Supabase access, log files, terminal commands, an AI
agent, or a hand-constructed URL.

Each criterion is demonstrated against real data, not asserted from tests.

| # | Criterion |
|---|---|
| **A1** | **Authenticate.** Reaching Command Center unauthenticated is refused on every route. Authenticating shows the operator the identity that will be attributed to their writes. |
| **A2** | **Read system health.** Every §17 signal is shown with its detection basis, its window, and a state of working / degraded / broken / off-by-configuration / unknown. Nothing is hardcoded. |
| **A3** | **Find a pick.** A pick submitted through Smart Form is found by property, with a total that matches the rows, and opened from the result. |
| **A4** | **Read its lifecycle.** The pick detail page answers §8.4 in full, with every §8.3 section present. |
| **A5** | **Confirm Track Only is inert.** For a track-only pick, the page affirmatively shows no outbox row, no receipt and no delivery attempt (§9.2). |
| **A6** | **Confirm delivery truth.** For a delivery-eligible pick, the page shows its routing destination, the field that supplied it, the delivery outcome, and — where it did not deliver — the specific refusal reason, correctly distinguished from track only (§9.3). |
| **A7** | **See kill-switch state.** Every governed target's state is shown, with who set it, when, and why; a target with no record reads as killed. |
| **A8** | **Settle a pick.** A real outcome is recorded through Command Center with source, confidence, evidence reference and the authenticated actor — and the resulting record is visible on the pick, attributed to the Command Center operator identity. |
| **A9** | **Correct a settlement.** The correction supersedes without destroying the original, the chain is visible, and the statistics move accordingly. |
| **A10** | **See recap truth.** Every settled delivered pick shows posted / not posted with a reason / not applicable. No blanks. |
| **A11** | **Read an exception queue.** A real operational exception is discoverable without a hand-constructed URL, and the row explains the condition, elapsed time and available action. |
| **A12** | **Resolve an exception.** An exception is opened, understood from the row alone, acted on, and observed to leave the queue. |
| **A13** | **Read capper performance.** Per-capper record, units and ROI reconcile against the underlying settlement rows, each rate carries its sample size, and blocked metrics read as blocked rather than as zero. |
| **A14** | **Read aggregate performance.** The aggregate reconciles against the sum of its parts over the governed population, with fixtures excluded. |
| **A15** | **Meet every state safely.** Normal and naturally occurring loading, empty, degraded, blocked and error states are demonstrated against production where safe. Any state that would require intentionally degrading or damaging production is demonstrated in controlled staging/browser verification instead. Every state behaves per §18 and no raw engine error is ever rendered. |
| **A16** | **Survive the phone test.** Every §21.2 surface is usable at phone width. |
| **A17** | **No placeholder anywhere.** No band-1 surface renders `—`, `N/A`, `0` or blank where the system holds a value (§5.4). |
| **A18** | **Nothing member-facing was activated to achieve any of the above.** |

**A18 is a condition of acceptance, not a footnote.** An acceptance run that required opening a
member-facing delivery target did not demonstrate what these criteria exist to demonstrate.

---

## Appendix A — Contradiction ledger

Every conflict found across the retired corpus, and how this contract resolved it. Resolutions
follow the ratified reconciliation order: current product direction wins; then current
architecture / data / security contracts for system boundaries; then shipped code establishes what
is *implemented* (without thereby overriding intended behaviour); then direct runtime evidence
establishes what production *does*; and a stale plan, audit or handoff never wins merely because it
once said "canonical".

| # | The contradiction | Resolution |
|---|---|---|
| 1 | Three documents specified Command Center as a UI consuming a separate generic read-only backend service's endpoints; a fourth declared that backend decommissioned. Current code reads persisted business data directly through its own server-side data layer, while live runtime truth/health uses narrow authenticated readers against canonical API/runtime endpoints. | **The generic read-backend architecture is retired; the runtime exception is preserved.** §6.2: business reads are direct to the canonical database, while runtime/process truth may use approved authenticated runtime/API readers because the database does not own that truth. The old operator-web endpoint architecture remains void. |
| 2 | One contract stated "Command Center is NOT a direct database writer — all writes go through API", which was widely read as forbidding direct reads as well. | **The boundary is now explicit.** §6.1: persisted business reads use the server-side data layer; live runtime truth may use the narrow approved runtime/API readers; writes never go directly to the database. The original prohibition was about writes and remains fully in force. |
| 3 | The launch contract listed research tools and filtering as non-goals; a ratified IA document established a Research workspace; a later phase contract mandated filtering. | **The four bands resolve it** (§2). Filtering is band 1 (§8.1) because finding a pick is a launch requirement. Research is band 3 (§4.5), and several of its surfaces are currently band 4 on provider data. "Non-goal at launch" is a scheduling statement and never a deletion (§2.4). |
| 4 | A phase contract listed "a full Outlier-style research terminal" as an explicit non-goal. The current product direction names replacing dependence on exactly those external tools as the long-term goal. | **The current product direction wins.** It becomes band 3 (§4.5, §4.6). Not launch-scoped, and explicitly not cancelled. |
| 5 | One "contract" carried a status of ready-for-implementation and no body — its content lived only in a conversation that no longer exists. | **Void.** A document that cannot be complied with governs nothing. Nothing was carried forward from it, because there is nothing to carry. |
| 6 | A Command Center document defined its own merge and approval policy, competing with the repository's mechanical merge authority. | **Out of product scope entirely.** Merge authority is defined mechanically by the merge gate and is reserved to PM. A product contract does not set merge policy, and this one does not. |
| 7 | A ratified language guide described a two-package architecture in which Command Center consumes a separate generic backend's APIs for product data. | **Void by the same evidence as 1.** The guide's naming rules survive and are restated in §19.1; its old read-backend architecture does not. This does not prohibit the narrow runtime/health readers explicitly allowed by §6.2. |
| 8 | At least four documents each claimed independent gating authority over overlapping scope: an IA ratification gating a phase, a metrics register forbidding any metric without an entry, a module-pattern spec requiring divergent pages to be corrected before merge, and an LLM contract forbidding LLM work without it. | **Consolidated into this contract, which is the only Command Center product authority.** The substance survives as rules — §5.5 volume gates, §5.3 engine-decision display, §18 state design, §20 LLM restrictions — enforced as product requirements. None of them is a separate gate, and none adds a check, an approval artifact or a lane type. |
| 9 | A legacy operator pick-composition surface exists and posts to the submission endpoint without the governed payload, producing picks invisible to every governed surface — while the current product direction states that pick creation belongs to Smart Form. | **The product direction wins.** §1.4 and §4.4: Command Center has no pick-composition surface, the legacy one is retired product, and it is not a specification for a future one. |
| 10 | A status document recorded the live settlements as attributed to a Command Center operator identity. Measured against production, every one of them carries an agent actor; the Command Center settle path has no production write attributed to it. | **Runtime evidence wins.** The settle path is **unexercised**, which is not the same as broken. Acceptance criterion A8 exists precisely to exercise it, and the status claim is corrected where it was made rather than repeated here. |
| 11 | A burn-in contract specified operator surfaces in terms of a snapshot endpoint's field names on the decommissioned backend, mixing genuine operator requirements with a dead transport. | **Requirements kept, transport dropped.** The delivery, runtime, provider and scorecard *requirements* survive in §13 and §17; the endpoint-and-field specification is void by 1. |
| 12 | A lifecycle-minimum spec enumerated real invisibility gaps — a pick detail view spanning many tables, a submission ingestion trace, a manual review queue, void visibility — against the decommissioned backend's routes and types. | **Gaps kept, routes dropped.** They are §8.3, §16.1 and §8.1 of this contract. This is the clearest case of a document whose *findings* were correct and whose *specification* was addressed to a system that no longer exists. |
| 13 | Nav and IA documents specified exactly four top-level workspaces; the shipped route tree has grown many more top-level entries and duplicated subject matter across namespaces. | **The four-workspace IA wins as intent** (§3.1), because the shipped tree is drift rather than a decision. The reconciliation is recorded as a gap and is not performed by this contract. |
| 14 | Documents disagreed on whether approval applies to human capper submissions. | **Approval is for system-generated picks only** (§16.4), consistent with the standing product rule. A human capper submission never enters approval merely because it is delivery-eligible. |
| 15 | A blocked-capability taxonomy existed in one document (shippable / shell-only / blocked by provider, multi-book, historical backfill, or closing-line data) with no relationship to launch priority, so "blocked" and "unimportant" were indistinguishable. | **Band 4 replaces it** (§2.1, §2.2). A band-4 capability keeps its underlying band, so blocked never silently demotes a requirement. |
| 16 | A metrics register conditioned a class of metrics on a specific historical issue being closed. | **Replaced by a data condition, not an issue reference.** §5.6: a metric renders when its input exists. Tying product behaviour to a ticket number makes the contract stale the moment the ticket moves. |

### Owner-resolved product decisions

Two contradictions required product-owner judgment rather than engineering inference. They were resolved during this consolidation review and are recorded in Appendix D. They are no longer open questions.

---

## Appendix B — Retired documents

Each of the following is moved to `docs/archive/command-center/`, with a deprecated pointer stub left at its original path so existing references — including references inside sealed proof bundles and closed lane manifests — continue to resolve. **None of them is product or operations authority for Command Center any longer.** They are historical evidence: read them to understand why a decision was once made, never to determine what to build.

The dated `HUMAN_CAPPER_V1_LIFECYCLE_HANDOFF.md` is also moved into the same archive with a pointer stub. It was not one of the competing Command Center product contracts, but it contains timestamped runtime conclusions and implementation assumptions and therefore belongs with historical evidence rather than active operational guidance.

**From `docs/03_product/`**

- `COMMAND_CENTER_REDESIGN_CONTRACT.md`
- `COMMAND_CENTER_PHASE_2_CONTRACT.md`
- `COMMAND_CENTER_WAVE_3_CONTRACT.md`
- `COMMAND_CENTER_LIFECYCLE_MINIMUM_SPEC.md`

**From `docs/05_operations/`**

- `T1_COMMAND_CENTER_BURNIN_TRUTH_CONTRACT.md`
- `COMMAND_CENTER_AUDIT.md`
- `CC_IA_RATIFICATION.md`
- `CC_NAV_REDESIGN_SPEC.md`
- `CC_LANGUAGE_GUIDE.md`
- `CC_LLM_GOVERNANCE.md`
- `CC_ANALYTICS_SEQUENCE.md`
- `CC_MODULE_DEPENDENCY_MAP.md`
- `CC_MODULE_PATTERNS.md`
- `CC_INTELLIGENCE_WORKSPACE_MVP.md`
- `CC_INTELLIGENCE_METRICS_REGISTER.md`
- `CC_DECISION_OVERLAYS_SPEC.md`
- `CC_PLAYER_RESEARCH_DATA_MODEL.md`
- `CC_PROVIDER_TRUTH_VALIDATION_PANEL.md`
- `CC_UNIFICATION_TIER_CLASSIFICATION.md`
- `CC_COMPETITOR_BENCHMARK.md`
- `DECISION_WORKSPACE_MVP.md`
- `RESEARCH_WORKSPACE_MVP.md`
- `HUMAN_CAPPER_V1_LIFECYCLE_HANDOFF.md`

**From `docs/02_architecture/contracts/`**

- `CC_OPERATIONS_IA.md`

**Not retired, and why**

| Document | Status |
|---|---|
| `apps/command-center/CLAUDE.md` | Remains, as an **engineering instruction file only**. It describes how to work in the package — stack, boundaries, test runner, schema invariants — and points at this contract for product behaviour. It defines no product requirement. |
| Proof bundles referencing any retired document | Remain untouched. A proof bundle is sealed evidence bound to a merge; it is never edited to follow a document move. |

---

## Appendix C — Capability band index

A single place to look up any capability's band. Where a section governs it, that section is
authoritative; this index is navigation.

Every entry appears in exactly one band. A capability listed under band 4 is **not** also listed
under its underlying priority; that priority is recorded in the band-4 list as *when unblocked*
metadata and nowhere else (§2.2 rules 1–2).

**Band 1 — Launch Required.** Global health, jump-to-pick, operator identity (§4.1). Operations home,
picks list and search, pick detail lifecycle trace, exceptions, delivery and Discord operations,
settlement, corrections, recaps, system and runtime health, intervention and audit log (§4.2). Human
Capper lifecycle visibility in full (§9). Per-capper record / units / ROI / volume with its volume
gate, and the distribution-mode split (§14.3). Aggregate record / units / ROI over the governed
cohort (§15.1). Every data-truth rule (§5). Every state design (§18). Canonical language (§19).
Phone-usable subset (§21.2).

**Band 2 — Post-Launch Core.** Review queue and held queue (§16.1, §16.2). Score breakdown and
suppression/qualification analysis, promotion preview, routing and board views, board queue (§4.3).
Scheduled-run visibility, readiness scorecard, capper and member administration (§4.2). Per-capper
segmentation and capper-to-capper comparison (§14.3). Performance by selectable window, segment
analysis, engine-versus-operator comparison, trend over time (§15.1). Score-to-outcome calibration
and attribution (§4.6). Differentiated internal roles (§7.4). Scheduled recap visibility (§12.3).
Approval workflow for system picks, parked (§16.4). LLM commentary (§20).

**Band 3 — Future Intelligence Platform.** Matchup event identity and context; saved research,
watchlists and notes (§4.5). Portfolio, exposure and correlation intelligence; operator alerting and
signal feeds (§4.6). The Research workspace as a whole (§4.5) — its individual surfaces are banded
one by one there, and most are currently band 4.

**Band 4 — Data- or Provider-Blocked.** Each entry's current band is 4; the band in brackets is what
it becomes when its data dependency resolves, and it is scheduling metadata, never a second band.
None is failed, none is silently demoted, and none is satisfied by rendering a plausible number
(§5.6, §18.5).

- Closing-line value as a metric on a pick or capper — *when unblocked: 1* (§14.3, §15.1)
- CLV distribution and comparative analysis — *when unblocked: 3* (§4.6)
- Market-relative aggregate measures — *when unblocked: 3* (§15.1)
- Prop and offer explorer; player card identity and current lines — *when unblocked: 3* (§4.5)
- Player and matchup historical statistics, trends and splits — *when unblocked: 3* (§4.5)
- Line shopping and multi-book comparison; arbitrage and middling — *when unblocked: 3* (§4.5)
- Line-movement and sharp-action intelligence — *when unblocked: 3* (§4.6)
- Decision overlays: middling, hedging, board fit — *when unblocked: 3* (§4.3)

---

## Appendix D — Owner product decisions resolved in consolidation

These two questions required product-owner judgment rather than engineering inference. Griff resolved both during consolidation review. The positions below are ratified product decisions within this contract; changing either requires an explicit owner amendment.

### D1 — Four-workspace information architecture

The shipped route tree contains additional top-level entries and duplicated subject matter. That is implementation drift rather than a recorded product decision.

**Owner decision: retain the four canonical workspaces — Operations, Decision, Intelligence and Research.** Convergence should target that mature structure rather than re-cutting the product around the current route tree. An unfinished workspace does not have to appear as an active navigation destination until it contains a usable capability (§3.2).

### D2 — Basic performance at launch

Record, units and ROI over the governed cohort remain part of launch because Unit Talk cannot credibly operate a transparent performance product if its own operator surface cannot reconcile the underlying history.

**Owner decision: keep basic per-capper and aggregate performance in band 1.** Deeper segmentation, calibration, comparison and market-relative intelligence remain later bands (§14, §15).

Neither decision is an open implementation question. Changing either requires an owner amendment to this contract.

