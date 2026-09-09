# Smart Form — Product Intent

**Status:** ACTIVE. **Owner:** PM (Griff) for intent; Claude for reconciliation against live truth.
**Consolidated:** 2026-09-06, from the ratified mission, the existing Smart Form contracts, the
implementation on `main` at `551edfe67`, production measurements taken the same day, and Griff's
explicit corrections during the live Milestone 1 pilot.

This document states **what the Smart Form is for and what it must do**. It is a product intent, not
a new contract family, not a gate, and not a process. It introduces no threshold, no required check,
no approval artifact and no new lane type. Where a canonical contract already governs a behaviour,
this file points at it rather than restating it, and where a canonical contract is **wrong**, this
file says so and the contract is corrected in place — never shadowed here.

Nothing in this document is a prerequisite for the Smart Form repair currently in flight.

---

## 1. What the Smart Form is

The Smart Form is the **operator-facing front door of the entire pick pipeline**. It is the only
surface through which a human capper creates a pick. Everything downstream — scoring, promotion,
grading, settlement, CLV, statistics, and eventually member delivery — consumes what this form
produces. A pick that is wrong here is wrong everywhere, permanently, and no downstream repair
recovers the truth of what the capper actually intended.

That gives the form two obligations that outrank speed and polish:

1. **It must be usable by a real operator on a real device**, quickly, without engineering help.
2. **It must never record something it cannot honestly stand behind** — not a fabricated identity,
   not a canonical claim it did not verify, and not a coverage gap that was really a transient
   failure.

These two obligations conflict in exactly one place: when canonical reference data is missing. The
resolution is not to relax truth and not to block the operator. It is to **degrade explicitly and
record the degradation truthfully** — the three-tier ladder in §4.

## 2. Who it is for, and in what order

Ratified delivery order (`docs/mission/intent.md` § "Delivery order"):

1. **Milestone 1** — a contained internal Track Only pilot: Griff, personally, once, end to end.
2. **Milestone 2** — the same path made *routine* for internal operators, producing a real graded
   and settled performance history.
3. **Member-facing delivery** — separately reserved, and explicitly not part of either.

The form is built for internal cappers first. Member-facing behaviour is not a Smart Form concern
at all: Track Only is pinned server-side and delivery cannot be enabled from this surface.

---

## 3. The complete journey, and what governs each step

Each row names the required behaviour, the implementation that exists today, and how that behaviour
is *meaningfully* verified. "Meaningfully" excludes merge counts and unit-test counts — see §7.

### 3.1 Reach the form

The form is deployed at the host named by `UNIT_TALK_SMART_FORM_DOMAIN`, routed by Caddy to the
`smart-form` container (`deploy/production/Caddyfile`, `deploy/production/docker-compose.yml`). The
hostname is a secret and is not recorded in the repository.

**Verified by:** reaching it in a browser. The container healthcheck is
`curl -fsS localhost:4400/login` (`deploy/production/docker-compose.yml:223`) and returns 200 regardless of whether
anyone can actually sign in — it is a liveness probe, not usability evidence.

### 3.2 Authenticate, and resolve canonical identity

Google OAuth via Auth.js v5 (`apps/smart-form/auth.ts`), gated on an explicit allow-list.

The identity rule is the load-bearing part. `ALLOWED_CAPPER_EMAILS` is a comma-separated list of
`<email>=<canonicalCapperId>` pairs; `<canonicalCapperId>` must match `^[a-z0-9][a-z0-9_-]*$`. An
entry without `=` is **dropped**, with no fallback to the email local part
(`lib/auth-allowlist.ts:43-66`). `auth.ts:24` admits a sign-in only when
`findAllowedCapper(email, allowedCappers) !== null`, and `auth.ts:35-40` puts the resolved
`capperId` into the session JWT. `apps/api/src/handlers/submit-pick.ts:143-144` prefers that claim
over whatever `submittedBy` the form sent.

**Why this matters:** the value becomes the persisted identity of a real pick. Deriving it from an
email local part — the pre-#1488 behaviour — silently attributes picks to a non-canonical capper.

**Verified by:** signing in, and reading the resolved id back off a persisted pick.

**What is actually established as of 2026-09-06, and what is not.** Sign-in succeeded against
production `d3f69b804`, and #1488 (`2ac233424`) is an ancestor of that commit — verified with
`git merge-base --is-ancestor`. Because `auth.ts:24` admits a sign-in only when
`findAllowedCapper` returns non-null, and the post-#1488 parser drops any entry without an explicit
`=<canonicalCapperId>`, a successful sign-in on this build **proves an explicit canonical mapping
was used and that local-part derivation did not occur**. It does **not** by itself establish which
id was resolved. Confirming that the persisted `capper_id` is `griff843` requires a pick to exist,
and no pick has persisted yet — step 4 is blocked (§8). The claim is deliberately left at what the
evidence supports.

**Known hazard, unfixed:** the allow-list is validated *non-empty* at three layers
(`deploy.yml:100`, `:486`/`:974`, `deploy/production/nextjs-entrypoint.sh:28-31`) and
**shape-validated at none**. A syntactically valid list that admits nobody deploys green, and the
first real test of the value is a browser. See `docs/mission/plan.md` § "The deployment decision
packet" for the one-command pre-dispatch check.

### 3.3 Choose a sport, and let the sport constrain everything after it

Sport selection drives which market types, stat types and participant kinds are offered. The
sport-market matrix and the team-sport / individual-sport split are canonical in
`docs/05_operations/SMART_FORM_SPORTSBOOK_CONSTRAINT_CONTRACT.md`; invalid combinations fail closed.

**Implementation:** `MarketTypeGrid.tsx`, `lib/market-types.ts`, and the `TEAM_SPORTS` set at
`apps/api/src/smart-form-validation.ts:9`, enforced again server-side.

**Verified by:** the sport-filtering e2e coverage in `apps/smart-form/e2e/phase-one.spec.ts`, plus
`apps/smart-form/test/form-schema.test.ts`.

### 3.4 Identify the matchup and the participants — from the database

**Griff's correction, 2026-09-06, and it is now intent:** *"I shouldn't have to manually type teams.
teams should pull from our DB."*

This is not a new requirement. `SMART_FORM_V1_OPERATOR_SUBMISSION_CONTRACT.md` acceptance criterion
5 already requires governed identity fields to use "controlled selects backed by reference data",
and criterion 6 forbids hard-coded option catalogs. The defect is that the UI honours this only on
the canonical event-bound path and abandons it entirely on the fallback path.

Required behaviour:

- Away and home participants are chosen from **sport-filtered, database-backed selectors** wherever
  coverage exists — including when no canonical *event* exists.
- Their **canonical participant IDs are preserved into the submission**. A display name alone is not
  an identity.
- The **matchup name is derived automatically** from the two selections (`${away} @ ${home}`), never
  hand-typed.
- **The same participant cannot occupy both sides**, refused in the browser before submission.
- Free text is reachable **only** where coverage is genuinely absent (§4).

**Implementation today:** `ParticipantAutocompleteField` (`BetForm.tsx:371`) is DB-backed and
sport-filtered; `applyStructuredSideSelection` (`:1775`) already derives the matchup name and
already refuses a duplicate side. The server already accepts a canonical resolution *without* an
event for team sports (`smart-form-validation.ts:64-72` → `validateStructuredTeamFallback`, which
re-validates both IDs against reference data).

**Gap:** the client never produces that shape. The manual toggle drops straight to two plain text
inputs, skipping the DB-backed tier that the server already supports. Tracked as **UTV2-1842**
finding B.

### 3.5 Enter the odds

American odds: integer, non-zero, ±100 to ±50000
(`SMART_FORM_V1_OPERATOR_SUBMISSION_CONTRACT.md` § "Odds — American Format";
`apps/smart-form/lib/form-schema.ts:27-32`).

**Signed odds must be enterable on the device the operator actually uses.** This is stated
explicitly because the contract previously prescribed an input mode that made it impossible — see
§6.1. A negative-odds range is meaningless if the control cannot accept a minus sign.

**Verified by:** the rendered input attributes *and* the persisted value. Schema acceptance alone is
not evidence — the schema always accepted `-110`; the keypad did not.

### 3.6 Review the bet slip

The form reads as a bet slip: constrained, fast, mobile-usable, with the ticket assembled and
reviewable before submission (`BetSlipPanel.tsx`; `SMART_FORM_V1_OPERATOR_SUBMISSION_CONTRACT.md`
criteria 1 and 13). Payout is computed from American odds and units (`calcPayout`,
`lib/form-utils.ts:50`).

Conviction (1–10, required) is entered here and mapped to submission `confidence` — see §6.2 for the
contradiction this resolves.

### 3.7 Submit

`POST /api/submissions`, source pinned to `smart-form`, body capped at 64KB. Client-side guards
mirror the server rules once, in `evaluateSubmissionGuards` (`lib/form-utils.ts:608`), so the
operator is refused *before* a round trip rather than after a 422.

Server-side, in order: `validateSmartFormRelationships`
(`apps/api/src/controllers/submit-pick-controller.ts:36`) establishes the resolution tier and
verifies it against reference data; then `processSubmission` runs the pipeline.

**Verified by:** `apps/api/src/smart-form-validation.test.ts`, `submission-service.test.ts`, and the
submission e2e specs — and, decisively, by an actual submission through the deployed form.

### 3.8 Receive a truthful receipt

`SuccessReceipt.tsx` reports what was actually created, including enrichment/domain-analysis status
(`SMART_FORM_V1_OPERATOR_SUBMISSION_CONTRACT.md` criterion 15). The receipt must never claim more
than the response supports.

### 3.9 Persist Track Only truth

This is the safety boundary of the whole surface, and it is enforced server-side, not by the form.

- `handlers/submit-pick.ts:93-106` — an authenticated capper's submission is **pinned** to
  `distributionMode: 'track-only'`, and an explicit contrary value is refused with
  `CAPPER_TRACK_ONLY_REQUIRED`.
- `:119-123` — a Smart Form submission that declares no `distributionMode` at all is refused.
- `submit-pick-controller.ts:86-101` — a Track Only pick returns `outboxEnqueued: false` and takes
  no distribution path.
- UTV2-1672 additionally guards direct enqueue, retry, requeue, the outbox chokepoint, the atomic
  RPC chokepoint and recap exclusion. **Each has a test that fails when the guard is removed** —
  the guards are mutation-tested, not merely present.

**What "persisted truth" means concretely:** the pick row carries the canonical `capper_id`, a
`metadata.distributionMode` of `track-only`, honest participant provenance, and **zero outbox
rows**. Because `:119-123` refuses a submission lacking `distributionMode`, a `null`
`distribution_mode` on a *new* pick is a failure signal, not "not applicable".

### 3.10 Observe the result

A governed, read-only internal observation of the persisted pick, its distribution mode, its
provenance and the absence of any delivery record. Per `docs/mission/intent.md` § "Step 7", a
deployed Command Center is **not** required for this, and no `COMMAND_CENTER_*` secret is a
prerequisite. `GET /api/picks/:id/trace` is authenticated as of #1501 (`b7d9fc07f`).

---

## 4. Honest fallback — the three-tier ladder

This is the single most important product rule in this document, and the one most often got wrong.

| Coverage situation | Tier | What is recorded |
|---|---|---|
| A canonical event exists and matches | **canonical + event** | full canonical identity, `eventId` set |
| Teams resolve, but no event exists | **structured team fallback** | real canonical participant IDs, `eventId: null` |
| Teams genuinely absent from the catalog | **explicit manual** | `canonical-coverage-gap`, participant IDs `null` |

Three rules bind it:

1. **Provenance must be truthful about which tier was used.** Manual is deliberately all-or-nothing:
   `validateManualResolution` (`smart-form-validation.ts:98-103`) **fails** any manual submission
   whose participants carry a `canonicalParticipantId`, so coverage-gap provenance cannot launder
   real IDs. The middle tier exists precisely so real IDs are not thrown away when only the *event*
   is missing.

2. **A claimed coverage gap is verified, not trusted.** `findCanonicalCoverage`
   (`smart-form-validation.ts:500`) searches the catalog and the search endpoints, folds
   confusables and city prefixes, and **refuses** the manual override if the entered name is in fact
   covered. A manual override is not an opt-out of canonical checking.

3. **A transient failure is never a coverage gap.** A failed participant search and an empty
   participant search are different facts and must be represented differently, per side. A search
   error surfaces as retryable; it must never silently become permanent `canonical-coverage-gap`
   provenance on a real pick. Griff's correction, 2026-09-06: *"a sport-wide availability flag is
   insufficient."*

**Gap today:** `apps/api/src/handlers/reference-data.ts:37` is `teamsAvailable: teams.length > 0` —
one boolean for a whole sport, which can express neither partial coverage nor a failed search.
Tracked as **UTV2-1842** finding C.

### 4.1 Fallback is not a workaround for an empty catalog

Reference-data population is **out of scope of the fallback design** — but not because it is
impossible under containment. **Corrected 2026-09-06:** an earlier draft of this section claimed
that "seeding the catalog requires unparking provider ingestion." That is false, and
`docs/05_operations/T1_REFERENCE_DATA_SEEDING_AND_RECONCILIATION_POLICY.md` (RATIFIED 2026-04-02)
§1 says so directly.

Two different actions were conflated, and the policy separates them:

| | Authorized static reference-data seeding | Provider activation |
|---|---|---|
| What it is | A governed static seed applied by migration — sports, leagues, **teams**, sportsbooks, market families, market types, stat types | Turning paid provider ingestion on |
| Source | `V1_REFERENCE_DATA` → migration seed SQL, or operator-approved rows | SGO, live |
| Policy | Seeding policy §1: these domains are *"Governed static seed (migration)"*, refresh source *"None"*, providers contribute *"Nothing"* | `T1_PROVIDER_INGESTION_CONTRACT.md`; `SYNDICATE_MACHINE_MODE` |
| Which reserved decision | Production DDL / data (`docs/mission/intent.md` reserved item 1) | Paid provider commitment (item 3) and containment (item 6) |
| Needs the other? | **No** | — |

The policy's core principle is the reason: *"Providers are sources of observations, not sources of
truth."* Only **players** and **player-team assignments** are seeded from provider observations.
Teams are explicitly not: a team row *"cannot be created from a provider observation alone — must be
seeded from governed data or operator-approved"* (§2). So the NCAAF/NCAAB/SOCCER team gap below is
closable by an authorized static seed with containment fully intact.

**Neither action is a Milestone 1 prerequisite.** `docs/mission/intent.md` § "What step 4 does and
does not require" states that the pilot does not require canonical reference-data coverage, and this
document introduces no threshold of its own. Honest fallback provenance is what the pilot needs;
catalog coverage is what ordinary repeated use needs, and that belongs to Milestone 2 and is
sequenced on its own merits.

Measured 2026-09-06 in production: MLB 30 teams, NBA 30, NFL 32, NHL 32, **NCAAF 0, NCAAB 0,
SOCCER 0**; 789 events, **0 in the future**, latest `2026-07-02`. The fallback is therefore the
*normal* path under containment, not an edge case — which is exactly why its provenance has to be
honest.

### 4.2 User-facing language

Ratified by Griff, 2026-09-06. The operator is offered, in these words:

> **Select a matchup, or build one from away and home teams — the matchup name is generated
> automatically.**

Free text is offered only where coverage is genuinely absent, and is labelled as unresolved.

---

## 5. Pilot versus finished — these are different states and must not be conflated

**The contained pilot (Milestone 1)** proves the path works **once**, for **one pick**, submitted by
**one person**, under containment. It is defined to complete with provider ingestion, system picks
and member delivery all parked, and it does not require canonical reference-data coverage. Its
seven steps are enumerated in `docs/mission/intent.md`.

**A finished, repeatably usable Smart Form (Milestone 2 and beyond)** means something strictly
stronger:

| | Contained pilot | Finished Smart Form |
|---|---|---|
| Submissions | one | repeated, routine |
| Operators | Griff | the intended internal operators |
| Engineering help | acceptable per submission | **none per submission** |
| Reference data | may be absent; honest fallback | coverage adequate for ordinary use |
| Grading / settlement | not required | runs on schedule against real results |
| Statistics | not required | computed from persisted history, reconciling to rows |
| Containment | intact, by definition | some settings may need to move — each reserved |

**The pilot succeeding does not make the form finished, and the form being finished is not what the
pilot is for.** Conflating them is how a single successful submission gets read as product
readiness. Production readiness itself is defined solely by
`docs/05_operations/T1_PRODUCTION_READINESS_CONTRACT.md`; this document introduces no threshold.

---

## 6. Contradictions reconciled, and the contracts corrected

This section exists so the contradictions are resolved **once**, in the governing contract, rather
than copied into a second document. Each item below has been corrected in the canonical file.

### 6.1 The mobile signed-odds prescription — CORRECTED

`SMART_FORM_V1_OPERATOR_SUBMISSION_CONTRACT.md` § "Odds — American Format" simultaneously required
a **negative range of -100 to -50000** and an **`Input mode` of `numeric`**. Those cannot both hold:
`inputMode="numeric"` renders a digits-only keypad on iOS and Android with **no minus key**, so
`-110` is unenterable on a phone — on a surface the same contract requires to be "mobile-usable"
(criterion 13).

This was not a drafting nicety. `BetForm.tsx` implemented the contract faithfully, and Griff hit it
on a real device during the pilot: *"I'm unable to put - 110."*

**Resolution:** the contract's American-odds `Input mode` is corrected from `numeric` to `text`
with a signed pattern, and the reason is recorded inline so it is not "tidied" back. The validation
ranges are unchanged.

**The same defect was found one field over and is corrected with it.** The `Line` field prescribes
`Input mode: decimal` against its own range of `-999.5 to +999.5`, and `BetForm.tsx:3148` implements
it with the placeholder `e.g. -3.5`. `inputMode="decimal"` offers digits and a decimal separator but
**no minus key**, so a negative spread is unenterable on mobile for exactly the same reason. Griff
reported only the odds; reporting only what was reported would have left the identical defect one
field away. Decimal *odds* keep `decimal` — that range is genuinely unsigned.

### 6.2 Confidence on the operator form — CORRECTED

`SMART_FORM_V1_OPERATOR_SUBMISSION_CONTRACT.md` acceptance criterion 11 read **"Confidence is not
present on the operator form"**. Two later ratified contracts require the opposite:
`T1_SMART_FORM_V1_CONTRACT.md` adds a required `capperConviction` input, and
`T2_SMART_FORM_CONFIDENCE_CONTRACT.md` (UTV2-49) requires `buildSubmissionPayload()` to set
top-level `confidence`. Both are implemented (`lib/form-utils.ts:317,328,377`; conviction 10 maps to `confidence` 0.99,
not 1.0, per UTV2-1379's strict `confidence < 1` guard downstream — the displayed conviction stays
10/10).

**Resolution:** criterion 11 is corrected in place. The reconciled rule: **a raw `confidence` float
is never entered by the operator; conviction (1–10) is, and the form derives `confidence` from it**,
recording `metadata.confidenceSource: 'capper-conviction'` so a capper signal is never mistaken for
a market-derived one. The original criterion's *intent* — no hand-entered probability — survives;
its literal text did not.

### 6.3 Stale Smart Form app instructions — CORRECTED

`apps/smart-form/CLAUDE.md` described the app as **"Public-facing"** with **"No auth header
currently (submitter key should be added)"**. Both were false on `main` and dangerously so: an agent
reading that file would conclude the surface is unauthenticated and that pick identity is
unresolved. In fact Auth.js v5 with an allow-list has been in place since #1488, and the session
`capperId` is the persisted identity of every pick.

It also listed 3 test files (there are 6) and said nothing about Track Only, `distributionMode`,
`participantResolution`, the three-tier ladder, or containment.

**Resolution:** corrected in place, and pointed at this document.

### 6.4 Live-offer-first versus a parked provider — RECONCILED, no contract change

`T1_SMART_FORM_LIVE_OFFER_UX_CONTRACT.md` states "**Live offer mode is the default path. Manual
entry is fallback only.**" Under containment there are no live offers at all, so the fallback is in
practice the only path.

**This is not a contradiction and the contract is not changed.** The live-offer rule is a statement
about *precedence when provider data exists*, not a claim that it always exists — the same contract
already requires graceful degradation to manual entry. What the ratified mission adds is that the
degraded state is currently the *normal* one, and therefore that the fallback tiers must be as
rigorously specified as the live path. That is §4.

### 6.5 Provider market identity as a fail-closed intake gate — SCOPED, not in force

`SMART_FORM_PROVIDER_IDENTITY_REQUIREMENTS.md` (UTV2-1269) would require `provider_event_id`,
`sgo_odd_id`, `stat_id` and five more provider fields fail-closed at intake. That document declares
its own status as **"Requirements / planning only"** and states that implementation requires a
separate PM-approved lane.

**It is therefore not in force**, and it must not be read as a current Smart Form requirement — it
would make submission impossible while ingestion is parked. Its scope is *evidence-eligibility*, not
submission: a pick may be submitted and persisted without provider identity; what it cannot do is
claim CLV-grade evidence status. Recorded here so the distinction is not lost.

### 6.6 A superseded Phase 2 implementation path — no action

`SMART_FORM_V1_PHASE2_SPORT_FILTERING_AND_BETSLIP_UX_CONTRACT.md` documents an
`apps/smart-form/src/**` layout that no longer exists. It already declares itself historical in its
own header. Its *product* rules (sport-filtered market types, fail-closed invalid combinations)
remain live and are carried by the sportsbook constraint contract; its file paths are not authority.

---

## 7. What counts as verification here

**A merge, a green CI run, or a unit-test count does not establish that the Smart Form is usable.**
This is stated as product intent because the failure mode is real and recent: every defect Griff hit
during the pilot on 2026-09-06 was in code that had merged green, with passing unit tests, on a
deployed and "healthy" container.

Each defect and why the existing evidence missed it:

| Defect | Why green CI missed it |
|---|---|
| Every submission 422s on the event gate | No test seeds a *stale-only* events table; the InMemory fixture is either empty (gate skips) or current (gate passes) |
| Teams must be hand-typed in fallback | Tests drive `evaluateSubmissionGuards` directly; nothing asserts which control the UI renders |
| `-110` unenterable on mobile | The schema accepts `-110`, so every schema test passes; nothing asserts the input's `inputMode` |
| Search failure indistinguishable from empty | One boolean has no failure state to assert |

The evidence that actually bears on usability, in ascending strength:

1. **Unit tests** — the rule is stated correctly in the module under test. Necessary, weakest.
2. **Mutation checks** — the guard fails on the condition it names. This is what makes a passing
   test non-vacuous, and it is required for every Track Only guard (§3.9).
3. **Browser-level tests** — the rendered control, not the function behind it. `apps/smart-form/e2e/`
   under Playwright. **Note honestly: no CI workflow runs these** (`grep -rl "test:e2e" .github/`
   returns nothing), so they are operator-run evidence captured into a proof bundle, not a gate.
4. **Production-shaped fixtures** — a test whose data matches what production actually holds. The
   event gate defect is only reproducible this way.
5. **A real submission through the deployed form, by the intended operator, and the persisted row
   read back.** Nothing below this establishes usability.

One honesty rule carried from the pilot: verification of a *mobile* control means asserting the
attribute that determines the keyboard and the value that persists. A browser test does not exercise
a physical on-screen keyboard, and no evidence should be described as if it did.

---

## 8. Current state — required behaviour against implementation

Measured 2026-09-06 against `main` `551edfe67` and production `d3f69b804`.

**The state vocabulary is deliberate, and "Done" is the narrowest word in it.** A merge, a green
check or a passing unit test establishes none of these states on its own (§7):

| State | Means |
|---|---|
| **Exercised** | Actually performed against the deployed system, by a person, and observed |
| **Implemented; blocked in the deployed flow** | The code exists and its tests pass, but no operator can reach the behaviour today. Not "Done" |
| **Implemented; unreachable today** | The code exists and is not itself blocked, but its precondition is absent in production |
| **Partial** | Implemented for some inputs and not others; the table says which |
| **Gap** | Not implemented |

| Required behaviour | Implementation | Verification | State |
|---|---|---|---|
| Reach the deployed form | `smart-form` container + Caddy route | reached in browser | **Exercised** — pilot step 1 |
| Authenticate | `auth.ts`, Auth.js v5 + allow-list | signed in | **Exercised** — pilot step 2 |
| Canonical identity | `auth-allowlist.ts`, `submit-pick.ts:143` | explicit mapping proven by a successful sign-in on post-#1488 code; the resolved id is unread until a pick persists | **Partial** — see §3.2 |
| Sport-aware selections | `MarketTypeGrid`, `market-types.ts`, `TEAM_SPORTS` | unit + e2e, and reached in the browser | **Exercised** |
| DB-backed participants (event-bound) | `ParticipantAutocompleteField` | e2e | **Implemented; unreachable today** — production holds 789 events, **0 in the future** (§4.1), so no event binds |
| DB-backed participants (no event) | server accepts it; **client never sends it** | — | **Gap — UTV2-1842 B** |
| Derived matchup name | `applyStructuredSideSelection:1799` | e2e | **Partial** — canonical tier only, and that tier is itself unreachable today |
| Distinct sides refused in browser | `BetForm.tsx:1902` | e2e | **Partial** — skipped in manual tier |
| Honest fallback provenance | `validateManualResolution`, `findCanonicalCoverage` | unit | **Implemented; blocked in the deployed flow** — the event gate rejects before validation is reached |
| Partial coverage / search failure | `reference-data.ts:37` single boolean | — | **Gap — UTV2-1842 C** |
| Event gate tolerates a parked catalog | `checkEventExistenceGate` blocks everything | — | **Gap — UTV2-1842 A** |
| Signed odds on mobile | `BetForm.tsx:3922` `inputMode="numeric"` | — | **Gap — UTV2-1842 D** |
| Signed spread line on mobile | `BetForm.tsx:3148` `inputMode="decimal"` | — | **Gap — same defect, §6.1** |
| Bet-slip review | `BetSlipPanel`, `calcPayout` | unit, and reached in the browser | **Exercised** |
| Submission | `POST /api/submissions`, guards mirrored | unit + e2e | **Implemented; blocked in the deployed flow** — every real attempt 422s on the event gate (UTV2-1842 A). No pick has persisted |
| Receipt | `SuccessReceipt` | e2e | **Implemented; blocked in the deployed flow** — downstream of a submission that cannot succeed |
| Track Only persisted truth | UTV2-1672 guard set | **mutation-tested** | **Implemented; blocked in the deployed flow** — the guards are proven by inversion, and no live pick has yet passed through them |
| Read-only observation | `GET /api/picks/:id/trace` (authenticated) | — | **Implemented; blocked in the deployed flow** — there is no persisted pilot pick to observe |

**Read the table by that vocabulary and the shape of the work is unambiguous.** Milestone 1 steps 1
and 2 are *exercised*; step 3 is established only to the extent §3.2 states. **Step 4 is blocked by
UTV2-1842 A**, and steps 5, 6 and 7 are each *implemented and blocked behind it* — not failing, and
not done. Nothing below step 4 can change state until a real pick persists.

The distinction matters beyond bookkeeping: five rows in this table would have read "Done" on the
evidence of merged code and green tests, and an operator cannot perform any of the five today.

---

## 9. Delegated work — what must travel with the task

Any task touching the Smart Form product — **including backend work in `apps/api` that changes
submission validation, the event gate, reference-data endpoints or the Track Only guards** — carries
the following into its work packet, whether the executor is Claude or Codex:

**Required reading:** this document, plus the canonical contracts for whatever it touches
(`SMART_FORM_V1_OPERATOR_SUBMISSION_CONTRACT.md`,
`SMART_FORM_SPORTSBOOK_CONSTRAINT_CONTRACT.md`, `T1_SMART_FORM_LIVE_OFFER_UX_CONTRACT.md`,
`T1_SMART_FORM_V1_CONTRACT.md`, `T2_SMART_FORM_CONFIDENCE_CONTRACT.md`,
`DELIVERY_KILL_SWITCH.md` and `RUNTIME_MODE_CONTRACT.md` for anything near distribution).

**Applicable acceptance criteria**, quoted into the packet rather than referenced by number — the
executor should not have to resolve a cross-document numbering to know what it must satisfy.

**Standing criteria for any Smart Form change** — these apply on top of the task's own:

1. Track Only cannot be weakened. Any change near submission, enqueue, retry, requeue, the outbox or
   recap keeps its mutation check, and the check still fails when the guard is removed.
2. Provenance stays honest. No path may record canonical resolution it did not verify, or a coverage
   gap it did not prove.
3. A transient failure is never recorded as a permanent fact.
4. Operator-facing behaviour is verified at the level it lives at — a rendered control is evidence
   about a control; a schema test is not.
5. Reference-data population is not a fix *for a resolution or provenance defect*, and it is never
   a substitute for honest fallback. It is also not a reserved decision *about containment*: per
   §4.1, an authorized static team/league/market seed is a production-data action (reserved item 1)
   and is independent of provider activation (items 3 and 6). If a change appears to need catalog
   seeding, the task states which of the two it means, and does not conflate them.

---

## 10. Applying this to the other products

The same treatment is applied to **Command Center** and **the pipeline** *as those products are
worked* — not as a documentation program run ahead of them. Each gets, at the point of its next real
piece of work:

- one intent document at `docs/03_product/<product>/intent.md`;
- contradictions reconciled by correcting the canonical contract in place, never by shadowing it;
- required behaviour connected to implementation and to meaningful verification, with gaps marked;
- required reading and applicable acceptance criteria carried into delegated packets.

Command Center's existing contracts already live under `docs/03_product/` and are the source for
its intent when that work starts. It is **not deployed** today — it is in no production compose
service and behind no Caddy route (measured 2026-09-06) — so its known auth defects (UTV2-1812,
UTV2-1802) are pre-deployment hardening, not live exposure.

**This consolidation is not a gate, a framework, or an OS improvement program**, and no product work
waits on it. If it ever starts behaving like one, that is the defect.
