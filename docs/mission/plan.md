# Mission Plan — live

**Owner:** Claude. Rebuilt from live evidence on 2026-10-13 under WORK-2026101301 (issue #1747). Not a log, not a backlog, not Linear in Markdown.
**Measured against:** `origin/main` `f3a95272b` (re-read 2026-10-14; #1745 merged, UTV2-1972 closed), deployed release `ed89569df`, production `zfzdnfwdarxucxtaojxm` (read-only SQL), GitHub API.
**Archives, read on demand — never at session start:**
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

## 1. Current truth

| Fact | Reading (2026-10-13) |
|---|---|
| `origin/main` | `f3a95272b` |
| Deployed release | `ed89569df` — `Deploy` run `38397434631`, 2026-10-13, success. Confirmed mode `human-capper`: ingestor autorun and scheduling off, worker on, one enabled target (`official-picks`), `killSwitchEngaged: true`. |
| Runtime drift `deployed..main` | **0 files** under `apps/` and `packages/` (5 lane/proof files only). Re-measure with `git diff --name-only ed89569df..origin/main`. |
| Containment variables | `UNIT_TALK_HUMAN_CAPPER_DELIVERY_ENABLED=true`, `UNIT_TALK_HUMAN_CAPPER_DELIVERY_ALLOWLIST=griff843`, `UNIT_TALK_COMMAND_CENTER_ENABLED=true`. No `SYNDICATE_MACHINE_MODE` variable exists. |
| Kill switches | `official-picks`, `best-bets`, `trader-insights`, `exclusive-insights` all `killed = true`. |
| Governed pick cohort (`metadata ? 'distributionMode'`) | **14** picks, all submitted by `griff843`: 9 `track-only`, 5 `delivery-eligible`. Status: 9 validated, 2 voided, 1 posted, 1 settled, 1 queued. |
| Cohort settlement records | 6 over 6 distinct picks, all `operator` source. The table's 37,502 total is overwhelmingly CI fixtures. |
| Delivery in the last 14 days | 1 outbox row (`706b136b`, `official-picks`, `dead_letter`, `stale_pending_operator_review`), 0 receipts. |
| Participants | MLB 981, NHL 350, NBA 284, **NCAAF 266**, NFL 32. **No WNBA, no NCAAB.** |
| `public.sports` | NBA, NFL, MLB, NHL, NCAAB, NCAAF, Soccer, MMA, Tennis. **No WNBA row.** |
| Members | `member_tiers` has 0 rows. |
| SGO / ingestion | Parked. Newest `ingestor.cycle` 2026-06-30 (failed); newest `game_results` 2026-06-30; no events in the last 14 days (newest 2026-09-28). |
| Runtime heartbeats | `worker.heartbeat` and `grading.cron.heartbeat` succeeded 2026-10-13. `governance.awaiting-approval-drift` last run **failed** (10-13 12:45Z). |
| Readiness ledger | **RED**, generated 2026-10-13T00:23Z — *before* the latest deploy; `deploy_sha_alignment` is therefore stale. Blocking failures: `deploy_sha_alignment` (stale), `ingestor_health` and `grading_health` (SGO parked), `db_tripwires`. `worker_outbox_health` and `dead_letter_count` pass. |
| Open PRs | #1754 (Codex, T1, grading read fix, PM-approved, resyncing), #1739 (Codex, T2, delivery-ui path admission), #1738 (Claude, T1, constitution-matrix annotation), #1736 (website logo), this lane's PR, and the frozen or inadmissible #1556, #1505, #1498, #1495, #1492, #1491, #1451, #1429. |
| Lane manifests on `main` | 881 `done`, 28 `closed`, 37 `merged`, 2 `superseded`. Count with `jq .status docs/06_status/lanes/*.json`. |

**Measured, not assumed:** the cohort has one submitting identity. The deployed allow-list names one
capper (`griff843`). A second authorized identity is therefore a prerequisite for the evidence batch,
not a given (§3).

---

## 2. Production position

- **Milestone 1 is complete and historical** (pick `dfcd9486`, 2026-09-09). Track Only production
  acceptance was repeated on 2026-09-28 with `92789b58`: pick `track-only`, delivery refused with
  `track-only-requested`, 0 outbox rows, 0 receipts, 0 execution intents.
- **Track Only non-delivery is enforced, not incidental.** `isTrackOnlyPickMetadata` and the
  `TRACK_ONLY_INTENT_GUARD` gate submit, distribution, requeue, retry, recap, health and settlement.
  Every `track-only` pick on record has zero outbox rows.
- **NCAAF reference data is live.** The catalog migration was applied to production on 2026-10-12
  (266 teams; 1,647 pre-existing rows unchanged) and Griff confirmed the teams render in Smart Form.
- **WNBA is not yet usable.** Three things are missing in order: the migration merged and applied to
  production (#1745 merged at `51ca89c3e`, UTV2-1972 closed; the production apply is Griff's, with a fresh SQL read preflight), the Smart Form/API team-sport change merged and deployed,
  then a real submission (§6.A).
- **`706b136b`** is a `delivery-eligible` pick, `queued`, whose only outbox row is a `dead_letter`.
  It is held behind the kill switch. Do not requeue or alter it.

---

## 3. Evidence batch — working pilot measurement

This is **not** a readiness threshold, **not** an automatic declaration of success and **not** a cap
on picks collected. Griff decides whether the evidence satisfies him. The formal bar remains the T1
contract.

| Measure | Working target | Reading 2026-10-13 |
|---|---|---|
| Genuine successful submissions | 25 | 14 governed picks in total; 9 `track-only`. Count only genuine, non-fixture, non-voided submissions: **UNKNOWN** until a per-pick review is run. |
| Distinct authorized identities | ≥ 2 | **1** (`griff843`). A second identity needs allow-list and capper onboarding — Griff's gate. |
| Independently verified settled picks, covering relevant results and markets | 10 | 6 operator settlement records. "Independently verified" is **UNKNOWN**: no verification step has been recorded. |
| Persisted-to-surface and settlement reconciliation | 100% | Not yet measured as a ratio. |
| Unauthorized deliveries | 0 | 0 in the last 14 days; the dead-lettered `706b136b` row never posted. |
| Unresolved critical identity or data-truth defects | none | None known. WNBA and NCAAB participants are absent (§6.A, §6.C). |

Per-pick measurement is a read-only job over the governed cohort; build it before the next report so
the readings above stop being UNKNOWN. It must not use the `v_governed_pick_performance` view, which
filters `source = 'board-construction'` and cannot contain an operator submission.

---

## 4. Independent workstreams and safe parallelism

Concurrency is governed by `docs/governance/CONCURRENCY_CONFIG.json`, not by a number in this file.
A migration lane is a singleton and is forbidden alongside a runtime lane, whatever the file scopes.

| # | Workstream | Owner | State |
|---|---|---|---|
| A | WNBA vertical slice | Codex (migration), then Codex (T2 runtime) | #1745 **merged** (`51ca89c3e`); production apply not yet requested; runtime lane queued behind the apply |
| B | NCAAF live acceptance | **Griff** (submits), Claude (verifies read-only) | Waiting on Griff |
| C | NCAAB participant catalog | Codex | SMALL; queued behind the migration singleton |
| D | Command Center operator view | Codex (Delivery/UI, display only) | **Display gaps closed on `main`** (#1685, #1689, #1692); awaiting a deployed render. No lane to start. |
| E | Mission refresh (this lane) | Claude | WORK-2026101301 |
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

**A. WNBA.** Reference data exists only as migration `20261010170100_wnba_participant_catalog.sql`
(15 franchises, governed UUIDv5 ids, `unit-talk:wnba:<key>` external ids) in #1745. The rollback
refuses before deleting when the migration-created sport or league, or any seeded participant, is
referenced downstream. After merge: (1) prepare the production-apply packet with read-only pre-checks,
as was done for NCAAF; (2) Griff authorizes the apply — **reserved**; (3) the T2 runtime lane adds
WNBA to the three team-sport sets (`apps/smart-form/lib/form-utils.ts`,
`apps/smart-form/app/submit/components/BetForm.tsx`, `apps/api/src/smart-form-validation.ts`), the
`sports` count in `apps/api/src/server.test.ts`, contracts `reference-data.ts` and pick foreign-key
normalization (saved patches exist, to be reviewed and selectively reproduced, not blindly applied);
(4) Griff dispatches the deploy — **reserved**; (5) Griff submits a real WNBA Track Only pick and
Claude verifies read-only: persisted row, participant ids, no outbox, receipt or intent, and Command
Center visibility.

**B. NCAAF.** No catalog work unless a real defect is found. Acceptance is one real current Track
Only pick submitted by Griff, then a read-only check of the row, participant ids, absence of
outbox/receipt/intents, and Command Center visibility.

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
| 1 | **Apply the WNBA migration to production** — separate Griff approval, preceded by a fresh read-only SQL preflight and `supabase migration list --linked` (#1745 is merged; nothing is applied) | production DDL | WNBA appearing in Smart Form |
| 2 | **Dispatch the deployment** carrying the WNBA runtime change, only after the apply and as a separate approval | production deployment | WNBA submission |
| 3 | **Real contained WNBA acceptance** — one real Track Only pick after the deploy | operator action | WNBA vertical slice done |
| 4 | **Submit one real NCAAF Track Only pick** | operator action | NCAAF acceptance |
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
