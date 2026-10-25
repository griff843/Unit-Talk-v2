# Mission Plan — live

**Owner:** Claude. Rebuilt from live evidence on 2026-10-13 under WORK-2026101301 (issue #1747). Not a log, not a backlog, not Linear in Markdown.
**Measured against:** `origin/main` `4a88bcb49` (re-read 2026-10-15), deployed release `2be2aec81` (Deploy run `38673683471`, 2026-10-15), production `zfzdnfwdarxucxtaojxm` (read-only SQL), GitHub API.
**Archives, read on demand — never at session start:**
[`plan-readings.md`](plan-readings.md) (dated current-truth readings, production position, evidence batch) ·
[`plan-lessons.md`](plan-lessons.md) (operating lessons) ·
[`plan-history-2026-09.md`](plan-history-2026-09.md) (chronology through 2026-09-14, plus the archived 2026-09-28 edition of this plan)

Every dated figure below is a reading taken at an instant. Re-measure before relying on one, and mark
anything you could not verify **UNKNOWN**. Live evidence overrides this page.

---

## 0. Direction (ratified by Griff, 2026-10-13)

1. **Quantity, not calendar.** There is no time-boxed internal pilot. Success is the quantity,
   diversity, truthful completion and reconciliation of real pick lifecycles, whether that takes one
   day or seven. Elapsed time is reported as an observation, never as an exit condition.
2. **First commercial-operating milestone:** Griff and authorized cappers submit **real Track Only
   picks** through the deployed Smart Form, with accurate authenticated capper, event, market, line,
   units, odds and provenance; inspect them in the governed Command Center; record authorized real
   **manual settlement and correction**; and reconcile capper history and statistics — with **zero
   member delivery**. The single-pick Milestone 1 is historical evidence, not the finish line.
3. **Manual fallback is valid** where canonical event data is unavailable, provided it is labeled and
   claims no provider verification and no CLV. A pick needs neither SGO nor an event feed to be
   submitted and manually settled.
4. **Second milestone:** complete and verify every meaningful **data-independent** P0/P1
   prerequisite (§5) **before** asking Griff to buy or activate SGO. Distinguish intentionally parked
   ingestion and stale grading from implementation defects. Use staging and fixture proof while SGO is
   off. Never fabricate live provider evidence.
5. **SGO purchase and activation is a separate Griff gate** (§7), preceded by an evidence-backed
   minimal-provider usage, coverage, cost and rollback plan. Nothing here unparks a provider, the
   syndicate machine or member delivery by implication.
6. **The Discord Waves 0–6 program is independent.** A separate browser-capable Codex worker owns
   it. This plan neither duplicates nor sequences it; it only records its interfaces (§6.G).

None of this changes `T1_PRODUCTION_READINESS_CONTRACT.md`, its time windows or its 100+ automated
graded-pick requirement, nor the membership or Discord entitlement contracts.

---

## 1. Standing holds and where the readings went

Standing holds (not dated readings; they stay in force until Griff changes them):

- All four delivery targets (`official-picks`, `best-bets`, `trader-insights`, `exclusive-insights`) stay kill-switched. Un-killing is a Griff gate (§7 #8).
- Track Only never creates delivery. `human-capper` containment cannot deliver on its own (§8).
- Do not requeue or alter pick `706b136b` (a `delivery-eligible` pick whose only outbox row is a `dead_letter`, held behind the kill switch).
- No provider unparking, no containment change, no member delivery, no clearing of the stranded canary `processing` rows, no re-enabling of cron job 5 (§7).

The dated readings — current truth (§1), production position (§2) and the evidence batch (§3) — moved unchanged to [`plan-readings.md`](plan-readings.md), read on demand like the other archives. Every figure there is a reading taken at an instant: re-measure before relying on it.

---

## 4. Independent workstreams and safe parallelism

Concurrency is governed by `docs/governance/CONCURRENCY_CONFIG.json`, not by a number in this file.
A migration lane is a singleton and is forbidden alongside a runtime lane, whatever the file scopes.

| # | Workstream | Owner | State |
|---|---|---|---|
| A | WNBA vertical slice | Codex (migration), then Codex (T2 runtime) | **Done:** migration applied, #1755 merged and deployed, real Track Only acceptance passed (`803a541b`) |
| B | NCAAF live acceptance | **Griff** (submits), Claude (verifies read-only) | **Done:** acceptance passed (`8968f86c`) |
| C | NCAAB participant catalog | Codex | SMALL; queued behind the migration singleton |
| D | Command Center operator view | Codex (Delivery/UI, display only) | **Display gaps closed on `main`** (#1685, #1689, #1692); awaiting a deployed render. No lane to start. |
| E | Plan refresh | Claude | WORK-2026101405 (this lane) |
| F | Pre-SGO engineering completion | Codex, in bounded lanes | §5 |
| G | Discord Waves 0–6 | **Independent Codex worker** | Not duplicated here |

---

## 5. Pre-SGO engineering completion (second milestone)

Each stream is complete only with the evidence listed. A parked or stale reading is not by itself a
defect; a stream is *done* when its code path is proven against fixtures or staging with SGO off.
Revalidate each item against current code before building on it — the list below carries forward the
2026-09-28 audit and is a hypothesis, not a measurement.

| Stream | Prerequisite to prove while SGO is off | Exit evidence |
|---|---|---|
| Provider ingestion | Ingestion, normalization and failure paths run against recorded fixtures and staging; cost and quota are bounded and observable | Fixture/staging proof, a written minimal-provider usage and rollback plan |
| Event and result matching | Participant, event and result matching is deterministic and fail-closed on ambiguity | Replay proof over fixtures, including the manual `eventId: null` path |
| Automated grading | Grading handles all supported markets from fixtures; skip reasons are observable | Staging proof; grading skips are classified, not silent |
| CLV snapshot plumbing | Closing-line capture and CLV computation are wired and null-safe | Fixture proof; no CLV claim on a manual pick |
| Models, feature contracts, scoring evaluation | Feature contracts, scoring and evaluation run on truthful persisted picks | Evaluation over the governed cohort with provenance retained |
| Operator views | Command Center renders decision, mode, participant resolution, eventless-pick notes, voided banner, capper/units (display only) | Implemented on `main`; **not yet observed in the deployed Command Center** until a deploy carries it (Griff dispatches) |
| Security and recovery | Auth fail-closed, kill-switch release procedure, replay/double-post protection, dead-letter handling | Documented procedure plus proof |
| Observability | Delivery freshness derived from receipts; `/health` fails closed; `governance.awaiting-approval-drift` failure classified | Proof per defect |
| Commerce and entitlements | Tier sync authenticates with a scoped credential and surfaces refusal; tier-gated `/live` and `/today`; copy matches what is live. **Whop is the authority for payment, Trial end, cancellation/nonpayment and paid-role lifecycle:** verify the actual Whop product→role grant/revoke across subscription and Trial lifecycle, then address only a demonstrated guard/mirror gap — do not build a competing expiry or role-grant timer without proved need (#1752 stays parked pending that proof) | Proof per item; Whop setup remains Griff's |

Open governance/reliability work is capped at one lane alongside product work, and only where it
blocks production, repeatedly strands lanes or threatens data truth. Do not file new governance issues
for findings; record them in `plan-lessons.md`.

---

## 6. Workstream detail

**A. WNBA — complete.** Migration applied to production, runtime change merged (#1755) and deployed
(`2be2aec81`), and one real Track Only pick verified read-only (§2). No further WNBA work unless a
defect appears. WNBA events are not in the event catalog, so WNBA picks submit with `eventId: null`
(manual fallback, labeled, no provider verification, no CLV).

**B. NCAAF — complete.** Acceptance verified read-only (§2). No catalog work unless a real defect is found.

**C. NCAAB.** Classified SMALL: a bounded catalog from the NCAA directory (`sportCode=MBB`) reusing
the participant-catalog seed and reversibility machinery. `sports` and a league row already exist;
team participants are 0. It waits for the migration singleton and never delays A or B.

**D. Command Center operator view.** The 2026-09-28 gap list (delivery authorization decision and reason, requested vs persisted mode, participant resolution, edge fallback reason, eventless-pick note, voided banner, capper/units/Track Only badge on the list row, distribution-mode filter, kill-switch refusal reason) was re-verified against `origin/main` `59ea1ce32` on 2026-10-13 and is **already implemented** (`GovernedPickTruth.tsx`, `PicksExplorerClient.tsx`; #1685, #1689, #1692). No lane is needed. What remains is observation in the deployed app, which follows a deploy Griff dispatches; only a newly found gap starts a lane.

**G. Discord.** The independent Codex worker owns Waves 0–6. Formal current program: Wave 1
entitlement and access safety, not complete without live persona evidence (Free, Trial, VIP, VIP+,
Capper, expiry, cancellation, revocation, stale/composite roles, command/DM/button authorization,
Whop-to-Discord lifecycle). Watched or live delivery is a separate Griff authorization. The stale
Capitals pick is not suitable for release. This plan only guarantees the shared interface: Track Only
never produces delivery, and the kill switches stay as they are.

---

## 7. Decisions required from Griff

| # | Decision | Reserved under | Blocks |
|---|---|---|---|
| 1 | ~~Apply the WNBA migration; dispatch the deployment; WNBA acceptance; NCAAF acceptance~~ — **done 2026-10-15** under Griff's explicit authorizations (migration apply, deploy `2be2aec81`, canary gate approved by Griff) | — | — |
| 2 | ~~Settlement attribution~~ — **resolved by Griff 2026-10-15:** the three `command-center:dev-bypass` settlements are acceptable for now; the pilot picks and results are test data to be cleared before production. A logged-in Command Center settlement test comes later (needs a real operator login) | — | — |
| 3 | ~~Dodgers pick `dfcd9486`~~ — **waived by Griff 2026-10-15:** it stays unsettled and does not matter | — | — |
| 4 | Settle NCAAF `8968f86c` and WNBA `803a541b` after their games (tonight and Saturday). **Not a blocker:** nothing waits on them; keep submitting real Track Only picks (choose Track Only explicitly) | operator action | nothing |
| 5 | **Authorize a second capper identity** | capper onboarding / allow-list | the ≥ 2 identity measure |
| 6 | **SGO purchase/activation**, after the evidence-backed minimal-provider plan | paid provider, secrets | live ingestion, CLV, automated grading on live data |
| 7 | **Whop and Discord setup**: plan ids, webhook secret, roles, refund policy, prices and tier names | secrets, pricing authority | the paid-member path |
| 8 | **Un-kill `official-picks`** once its delivery gaps close | member-delivery activation | first member delivery |
| 9 | **Frozen PRs** #1491, #1492, #1495 architecture review; #1451 production DDL | merge authority; production DDL | those PRs only |

**Affirmatively not asked for:** any containment change, any provider unparking, any member delivery,
any clearing of the 32 stranded canary `processing` rows, any re-enabling of cron job 5.

---

## 8. Containment and production safety

- **Containment has four modes.** `deploy.yml`'s `case "$syndicate_machine_mode"` admits `active`,
  `parked`, `human-capper` and anything else exits 1. `human-capper` runs the worker with the
  ingestor and syndicate machine off and forces the one target `official-picks`.
- **Read the mode from the newest successful `Deploy` run's
  `{"event":"syndicate_machine_mode.validated","mode":…}` line, never from memory.** It is derived from
  the `SYNDICATE_MACHINE_ENABLED` secret plus `UNIT_TALK_HUMAN_CAPPER_DELIVERY_ENABLED`.
- **`human-capper` cannot deliver on its own.** Its target is independently killed at the live
  switch, and `isKilled()` fails closed for a target with no row.
- **Grading is deliberately not contained** (`UNIT_TALK_GRADING_CRON_AUTORUN=true`).
- **Standing prohibitions:** no direct-`main` bypass; every planned change lands by PR on green CI.
  Keep these decisions separate: a code merge is not a migration apply; a migration apply is not a
  deployment; a deployment is not a delivery release.
- **Branch protection on `main`:** required checks `verify`, `Executor Result Validation`,
  `Merge Gate`, `P0 Protocol`; `strict: true`, `enforce_admins: false`.

---

## 9. Authoritative pointers

| Question | Authority |
|---|---|
| Is Unit Talk production-ready? | `docs/05_operations/T1_PRODUCTION_READINESS_CONTRACT.md` — the **only** readiness threshold |
| Mission intent, reserved decisions, stop conditions | `docs/mission/intent.md` |
| Required outcomes and the canonical contract index | `docs/mission/spec.md` |
| Smart Form product intent | `docs/03_product/smart-form/intent.md` |
| What Command Center is and must do | `docs/03_product/COMMAND_CENTER_PRODUCT_CONTRACT.md` |
| Membership, tiers, entitlements | `docs/03_product/MEMBERSHIP_PRODUCT_CONTRACT.md` |
| Execution truth, lanes, done-gate, merge authority | `EXECUTION_TRUTH_MODEL.md`, `LANE_MANIFEST_SPEC.md`, `TRUTH_CHECK_SPEC.md`, `.github/workflows/merge-gate.yml` |
| Migration workflow | `docs/05_operations/DB_MIGRATION_WORKFLOW.md` |
| Results backfill, prepared and reserved | `docs/05_operations/RESULTS_BACKFILL_AUTHORIZATION_PACKET.md` |
| Operating lessons | [`plan-lessons.md`](plan-lessons.md) |

**Frozen pending PM architecture review — do not commit to, resume, or design against:** #1491, #1492,
#1495.

---

## 10. Lessons that change how this session acts

- **A limit is not a capacity.** PostgREST caps responses at 1000 rows; page with an ordered `range`.
- **The governed cohort predicate is `metadata ? 'distributionMode'`.** About nine tenths of `picks`
  are CI fixtures, and a wrong predicate fails silently.
- **A migration rollback must refuse before it deletes.** Deleting a shared `sports` row nulls
  `picks.sport_id` and cascades events, stat types and aliases; discover referencing foreign keys from
  `pg_constraint` rather than naming them.
- **A merged repair is not a running repair.** Only a successful `Deploy` run establishes what is
  executing, and only for its SHA.
- **Staging is one shared resource.** A full CI run and a separate proof gate on the same push can
  collide on a statement timeout; rerun the whole CI attempt once with staging idle, never `--failed`
  on `ci.yml`, and report a repeat as a staging-health blocker.
- **Do not choose a lane type to evade a concurrency rule.** That is an operating-model change
  reserved to PM.
