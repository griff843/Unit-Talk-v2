# Mission Plan — live

**Owner:** Claude. Rewritten as reality changes. Not a log, not a backlog, not Linear in Markdown.
**Last reconciled against live truth:** 2026-09-18, against `main` `17b3f964f`
**Archives, read on demand — never at session start:**
[`plan-lessons.md`](plan-lessons.md) (operating lessons) ·
[`plan-history-2026-09.md`](plan-history-2026-09.md) (chronological narrative through 2026-09-14)

This file is startup context. It answers only what a session needs before it can act, and it is
rebuilt from live GitHub, runtime and database evidence rather than edited forward from its previous
text. Anything that is history rather than state belongs in an archive above.

---

## 1. Current truth

Measured 2026-09-18 against `origin/main`, the GitHub API and production `zfzdnfwdarxucxtaojxm`.

| Fact | Value |
|---|---|
| `main` | `17b3f964f` (UTV2-1930, #1602 — the governed operator event-seeding CLI) |
| Deployed release | `961f17c64` — `Deploy` run `35289985486`, succeeded 2026-09-18T00:09Z |
| Drift `deployed..main` | **6 commits, 32 files, 1 migration (already applied), 3 deployment-relevant files** |
| The 3 deployment-relevant files | `apps/api/src/grading-service.ts` and `apps/worker/src/delivery-adapters.ts` (the UTV2-1929 recap channel-resolution repair) and `.github/workflows/deploy.yml` (writes `UNIT_TALK_CC_API_KEY` into `.env.production`). **Merged, not running.** |
| Governed pick cohort (`metadata ? 'distributionMode'`) | **7** — 6 `track-only`, 1 `delivery-eligible` |
| Settlement records for that cohort | **6**, every one `source = operator`, `confidence = confirmed`, real ESPN `evidence_ref` |
| Outbox rows for that cohort | **1** — `684ba33f…`, `discord:official-picks`, `sent`, `attempt_count = 0`: the accepted Human Capper canary |
| Newest `distribution_outbox` row repo-wide | 2026-09-18 01:36:57 — that same canary row |
| `official-picks` kill switch | `killed = true`, re-engaged 2026-09-18 06:31:22 immediately after the one recap attempt |
| Command Center | **enabled and deployed** — `{"service":"…","event":"command_center.enabled"}` in run `35289985486` |
| CLV on settled picks | **null on all 6** |
| Current-game reference data | **1** event in the last 14 days, `external_id = NULL`, **0** participants — nothing is selectable today |
| Newest `events` / `game_results` | **2026-06-30** — the results supply is still empty |
| Grading in production | alive, and deliberately outside containment |
| `SYNDICATE_MACHINE_MODE` | `parked` — unchanged |
| Open PRs | **11** |
| Active lanes | UTV2-1736, UTV2-1827, UTV2-1919 (all parked) · UTV2-1930 (merged, closeout repair in #1603) · UTV2-1931 (this one) |

**Milestone 1 is complete.** Performed by Griff end to end against the deployed system on
2026-09-09, verified by governed read-only production observation, containment intact throughout.
The full evidence narrative is in
[`plan-history-2026-09.md`](plan-history-2026-09.md#milestone-1--the-completion-record).

**Milestone 2 is the active milestone.** Where each of its six conditions stands is §3. The
Human Capper V1 lifecycle position and the two owner decisions it is blocked on are recorded
in full in
[`docs/05_operations/HUMAN_CAPPER_V1_LIFECYCLE_HANDOFF.md`](../05_operations/HUMAN_CAPPER_V1_LIFECYCLE_HANDOFF.md).

---

## 2. Production position

**`main` deploys. What is on `main` is not all of what is running.**

The previous edition said "what is on `main` is running". That was true at `40968bf80` and is
no longer true: three deploys have happened since, the newest is `961f17c64`, and `main` has
moved past it again.

- Deployed release: `961f17c64` — `Deploy` run `35289985486`, succeeded 2026-09-18T00:09Z.
- Drift `deployed..main` is **6 commits / 32 files / 1 migration, already applied in production**
  (`insert_certification_propagation_batch` exists with `p_records jsonb, p_events jsonb`).
- **Three of the 32 change what runs**, and all three are Human Capper V1 work:
  `apps/api/src/grading-service.ts` and `apps/worker/src/delivery-adapters.ts` (the UTV2-1929
  recap channel-resolution repair), and `.github/workflows/deploy.yml` (writes
  `UNIT_TALK_CC_API_KEY` into the `.env.production` it regenerates on every deploy).

The consequence is concrete, not theoretical: the one delivered pick settled and **no recap was
posted**, because the deployed resolver cannot read `discord:official-picks` as a channel while
the merged repair reads the numeric id the receipt already carries. Dispatching the deploy is
reserved action 8 — §5 decision 1.

**Readiness dimensions**, from `docs/06_status/readiness/readiness-score.json`:

| Dimension | Blocking | Status | What it means |
|---|---|---|---|
| `deploy_sha_alignment` | yes | fail | **no longer bookkeeping.** Real drift now, and it includes live-path files. |
| `ingestor_health` | yes | fail | **containment** — `SYNDICATE_MACHINE_MODE=parked` sets `AUTORUN=false`. |
| `worker_outbox_health` | yes | fail | **containment** — same mechanism. |
| `dead_letter_count` | yes | unknown | partial read yields `unknown` rather than a quiet pass |
| `db_tripwires` | yes | unknown | the observer itself is red, so tripwire state is unproven |

Four non-blocking dimensions (`pnpm_verify`, `scheduled_observer_health`, `proof_coverage`,
`constitution_convergence`) are `fail`/`unknown` and do not gate.

**Readiness still cannot reach GREEN while containment holds**, because two blocking dimensions
measure precisely the flags containment sets to `false`. That is unchanged and is not a defect.
The six-dimension T1 contract measurement is a separate and stricter instrument — see §8.

---

## 3. Active work

**Merged since the last deploy, and therefore not running:** #1600 (UTV2-1814, the governed
worker RPC), #1601 (UTV2-1929, the recap channel-resolution repair and the
`UNIT_TALK_CC_API_KEY` env line), #1602 (UTV2-1930, the governed operator event-seeding CLI).
See §2 for which files that actually changes.

**Milestone 2, measured against `intent.md`'s six conditions (2026-09-18):**

| # | Condition | State |
|---|---|---|
| 1 | Repeatable submission without per-submission engineering | **Blocked at reference data, not at the form.** 7 governed picks now exist (3 added since 2026-09-17), so the form itself repeats. But production holds exactly one event in the last 14 days, with `external_id = NULL` and **zero** participants — so nothing is selectable today and each new submission still needs an event seeded first. `scripts/ops/seed-operator-event.ts` (#1602) makes that seeding a governed one-liner instead of raw SQL. |
| 2 | Canonical identity and truthful provenance on every pick | **Holds for all 7.** |
| 3 | Grading and settlement on schedule against real results | **Settlement proven, scheduling not.** 6 of the 7 picks carry a `settlement_records` row — every one `source = operator`, `confidence = confirmed`, with a real ESPN `evidence_ref`. That is the attested operator route, which is honest and working; automated grading still has no result row after 2026-06-30 to grade against. |
| 4 | Statistics computed from persisted history | **Reconciles, minus CLV.** Read straight from the settlement plane: `track-only` 5 settled, 3W-2L, 17.50 units staked; `delivery-eligible` 1 settled, 1 loss, 3.50 units. `clvPercent` is **null on all 6**, so the CLV element of this condition is unmet and stays so until the provider decision resolves. |
| 5 | Operator observes through a governed internal surface | **Holds.** The Command Center is enabled and deployed, and operators wrote through it on 2026-09-18 — the six settlements and the kill-switch toggle are attributed to `operator:command-center:HGkYXQqj`. |
| 6 | None of it achieved by activating member-facing delivery | **Holds, with one accepted exception.** The single `delivery-eligible` pick was the PM-accepted Human Capper canary. `official-picks` is `killed = true` again as of 2026-09-18 06:31:22, and every `track-only` pick has zero outbox rows. |

Full lifecycle position, with every figure's query:
[`docs/05_operations/HUMAN_CAPPER_V1_LIFECYCLE_HANDOFF.md`](../05_operations/HUMAN_CAPPER_V1_LIFECYCLE_HANDOFF.md).

**The governed cohort predicate is `metadata ? 'distributionMode'`, and getting it wrong is silent.**
~93% of `picks` are CI fixtures predating staging isolation; `v_governed_pick_performance` filters
`source = 'board-construction'` and structurally cannot contain an operator submission; and
`capper_id = 'griff843' AND source = 'smart-form'` returns 13 rows, 12 of them 2026-05-29 proof
fixtures with 6 marked `settled`. Identify genuine submissions *positively*.

---

## 4. Blockers

| Blocker | Blocks | Owner |
|---|---|---|
| **The recap repair is merged and not running** — `961f17c64..main` carries `grading-service.ts`, `delivery-adapters.ts` and the `deploy.yml` `UNIT_TALK_CC_API_KEY` line | the post-delivery recap; durability of Command Center write auth across the next deploy | reserved decision 8 (dispatching a deploy) — §5 decision 1 |
| **No current game is selectable** — 1 event in the last 14 days, `external_id = NULL`, 0 participants | Milestone 2 condition 1 | operator: run `scripts/ops/seed-operator-event.ts` with production credentials |
| **Results supply: no `events`/`game_results` after 2026-06-30** | Milestone 2 condition 3 (automated grading) and condition 4's CLV element | reserved decisions 3/4 — §5 decision 2 |
| **A second data source cannot be admitted by an agent** | any non-SGO route to schedules or results | `PROVIDER_AUTHORITY_LOCK.md` is an active T1 rule naming SGO Pro as the sole live provider; amending it is PM-owned |
| **#1592 needs two head-pinned PM artifacts** | the Human Capper foundation | merge authority |
| **`migration` lane type unavailable** | UTV2-1871 and the Smart Form e2e gate enablement | approving #1484 |
| **`P0 Protocol` is blind to `WORK-###`** | tracker-independence exit condition 1 | reserved (merge authority). #1570 is CLOSED, not merged. |

**No longer a blocker:** the missing worker RPC (`insert_certification_propagation_batch`
exists in production), and the Command Center being switched off (it is enabled and deployed).

---

## 5. Decisions required from Griff

| # | Decision | Reserved under | Blocks |
|---|---|---|---|
| 1 | **Dispatch `Deploy` at `origin/main`.** Recommended. 6 commits, no unapplied migration; the three deployment-relevant files are the recap channel-resolution repair and the `.env.production` key line. **Non-secret success criterion:** the deployed release SHA equals `origin/main`, and a settlement on a delivered pick then produces a recap outbox row. | reserved action 8 | the post-delivery recap; §5 decision 1a below |
| 1a | **Whether to re-open `official-picks` for one bounded recap re-attempt** after that deploy | member-delivery activation (2) | the recap for canary pick `816a84c7` only |
| 2 | **Confirm whether the production `SGO_API_KEY` is active.** Prepared in `RESULTS_BACKFILL_AUTHORIZATION_PACKET.md`. **Non-secret success criterion:** one authenticated `GET` against the provider's account/usage endpoint returns `isActive: true` and a tier name. If inactive, this becomes a paid-provider commitment. There is no alternative exit in code. | secrets (4) / paid provider (3) | automated grading, CLV, and the routine reference-data supply |
| 3 | **Approve #1484** (canonical reference bootstrap, `verify` green) | merge authority | reopens the `migration` lane type, and with it UTV2-1871 and the e2e-gate enablement |
| 4 | **Re-issue `scope-override/v1` on #1592 at head, then `pm-verdict/v1` APPROVED + `t1-approved`** | merge authority (7) | the Human Capper official-picks foundation |
| 5 | **Verdict on #1589** (UTV2-1919, T1) | merge authority | #1589 only |
| 6 | **Whether to re-open the `WORK-###` Merge Gate parser work** | merge authority (7) | the tracker workstream only |
| 7 | **#1491 / #1492 architecture review** | merge authority | those two PRs only |
| 8 | **#1451** — production DDL, `verify` red | production DDL (1) | #1451 only |
| 9 | **Direct-`main` prevention control** | branch protection | nothing; the prohibition is already in force |

**Affirmatively not asked for.** No containment change. `SYNDICATE_MACHINE_MODE` stays `parked`.
No provider activation. No clearing of the canary outbox row.

---

## 6. Recommended / executable next wave

**Under existing authority, nothing reserved.** A reserved gate blocks only the work that depends on
it; everything here is independent of §5.

1. **Keep the plan and its archives honest.** This lane (UTV2-1931). Startup context must stay
   loadable, and this edition exists because the previous one's §1 had gone false in five places at
   once — cohort size, settlement count, Command Center state, deployed SHA, and newest outbox row.
2. **Seed a current event, then submit again through the deployed form** in market shapes not yet
   exercised — a player prop, a total, or a multi-leg slip. The seeding half is now a governed
   one-liner (`scripts/ops/seed-operator-event.ts`, #1602); the submitting half is operator action.
   Condition 1 is a claim about repeatability and only repetition tests it.
3. **Persist the grading skip histogram.** `grading-service.ts` records only `{picksGraded, failed}`,
   discarding the per-pick `outcome: 'skipped'` + `reason` it already computes — so a pass that
   examined 15,000 picks and graded none is byte-identical to one that examined zero. **Owned by
   UTV2-1605**, PM-ratified and routed to Codex. Not unowned; do not re-file.
4. **Repair `governance.awaiting-approval-drift`'s classification.** Built and proven (7/7 behaviour
   drill), filed as **UTV2-1871**, blocked only on the `migration` lane type. The repair belongs in
   the classification, never in the data.
5. **Re-home the inadmissible PRs** (#1429, #1491, #1492, #1495, #1496, #1498) through
   `ops:lane-start --readmit-existing-branch` under canonical issues. Renaming an open PR's head
   branch closes it and it will not reopen, so readmission means a replacement PR carrying the same
   diff.

**Not executable, and why:** the recap (needs the deploy — decision 1); automated grading and CLV
(need a trusted provider — decision 2, and note the *second* blocker: all six Track Only picks
carry `eventId: null`, so grading skips them at `event_link_not_found` before results are even
reached); anything needing a `migration` lane (blocked by #1484); the e2e gate (same).

**On the governance slot.** `intent.md`'s ratified debt policy makes the single
governance/reliability slot a **ceiling, not a quota** — it is staffed only when a defect currently
blocks production, repeatedly strands lanes, materially threatens safety or data truth, or has
accumulated enough *measured* operating cost. An empty slot alongside moving production work is a
correct state. The mechanical cap in `docs/governance/CONCURRENCY_CONFIG.json` is 3 concurrent
`governance` lanes; the PM ceiling is the tighter constraint and is the one to reason from. Record
findings under §9 and in `plan-lessons.md` rather than filing them; one defect class gets one
canonical issue, and a new occurrence attaches to it as evidence.

---

## 7. Containment and production safety

**Containment is intact and unchanged, and no change to it is requested.**

- `SYNDICATE_MACHINE_MODE` is `parked`. Provider ingestion, provider activation, system picks and
  member-facing delivery are all parked. Newest `ingestor.cycle` is 2026-06-30; newest
  `worker.heartbeat` is 2026-08-17.
- **Containment is binary.** `deploy.yml` admits `active | parked | exit 1` only. `active`
  simultaneously sets `_worker_autorun=true`, sets `SYNDICATE_MACHINE_ENABLED=true`, and releases
  `_enabled_targets` from the forced `none` — and the readiness assertion that delivery is off runs
  **only in parked mode**. So a request to unpark ingestion *is* a request to activate delivery.
  There is no bounded unpark.
- **The Command Center is enabled, and that was never a containment change.**
  `UNIT_TALK_COMMAND_CENTER_ENABLED` is `true` and the service is deployed — `Deploy` run
  `35289985486` emitted `{"service":"…","event":"command_center.enabled"}`. The flag gates only
  that service's env file, image promotion, compose membership and smoke check; it does not touch
  `SYNDICATE_MACHINE_MODE`, `_worker_autorun` or `_enabled_targets`.
- **Grading is deliberately not contained.** `deploy.yml` sets `UNIT_TALK_GRADING_CRON_AUTORUN=true`
  unconditionally, outside the `SYNDICATE_MACHINE_MODE` case statement. This is why grading runs
  while the ingestor and worker do not.
- **Non-delivery is enforced, not merely absent.** `isTrackOnlyPickMetadata` gates **eight**
  independent modules on `main`, re-measured 2026-09-17: `controllers/submit-pick-controller.ts`
  (the submit-time pin), `distribution-service.ts` (the enqueue chokepoint →
  `TrackOnlyDistributionError`), `run-audit-service.ts` (the atomic-RPC audit),
  `controllers/requeue-controller.ts`, `controllers/retry-delivery-controller.ts`,
  `recap-service.ts`, `routes/health.ts`, and `settlement-service.ts`. UTV2-1672 mutation-tested the
  original set. As defence in depth, `best-bets`, `trader-insights`, `exclusive-insights` **and
  `official-picks`** are all `killed = true` in `delivery_kill_switch` (re-measured in production
  2026-09-18). `official-picks` was re-engaged at 06:31:22, immediately after the single accepted
  Human Capper canary recap attempt.
- **One delivery has happened, and it was the PM-accepted canary.** `distribution_outbox` holds
  exactly one row created since 2026-09-01 — `684ba33f…`, `discord:official-picks`, `sent`,
  `attempt_count = 0`, routed `capper-pinned` off `cappers.metadata.discord.picksChannelId`. Every
  `track-only` pick still has zero outbox rows.
- **Member-delivery activation is separately reserved** and is explicitly not part of Milestone 2.
- **Standing prohibition:** ordinary direct-`main` bypass. All planned work lands via PR on green CI.
  One incident remains open and unrecorded — the 2026-09-02 push `717b46971`; `Direct Main Push
  Guard` fired red (run `33683588651`) and could not prevent it, because `enforce_admins: false`
  structurally exempts an admin credential. Prevention is decision 9.

Branch protection on `main`: four required checks — `verify`, `Executor Result Validation`,
`Merge Gate`, `P0 Protocol`. `strict: true`, `enforce_admins: false`, no push restrictions, no
required reviews.

---

## 8. Authoritative pointers

Live evidence overrides every snapshot, including this page. Where a document and the running system
disagree, re-measure.

| Question | Authority |
|---|---|
| Is Unit Talk production-ready? | `docs/05_operations/T1_PRODUCTION_READINESS_CONTRACT.md` — the **only** readiness threshold |
| The six-dimension contract, actually measured | `docs/05_operations/READINESS_MEASUREMENT_2026-09-14.md` — Dim 1 FAIL, 2 FAIL, 3 UNKNOWN, 4 UNKNOWN, 5 FAIL, 6 FAIL, `overall_pass: false`. An **UNKNOWN blocks the gate exactly as a FAIL does**. |
| The four-pick production acceptance (**superseded — the cohort is 7**) | `docs/05_operations/PRODUCTION_ACCEPTANCE_2026-09-14.md` |
| Human Capper V1 lifecycle position and its two owner decisions | `docs/05_operations/HUMAN_CAPPER_V1_LIFECYCLE_HANDOFF.md` |
| Results backfill, prepared and reserved | `docs/05_operations/RESULTS_BACKFILL_AUTHORIZATION_PACKET.md` |
| Reference-data coverage | `docs/05_operations/REFERENCE_DATA_AUDIT_2026-09-13.md` — NFL has 32 team participants and **zero** players; NCAAF has nothing; every catalog row predates 2026-07-01 |
| Provider coverage limits | `docs/05_operations/PROVIDER_KNOWLEDGE_BASE.md` §5 — NBA/NFL/MLB/NHL only, player props MLB/NBA only, no NCAAF/NCAAB |
| Mission intent, reserved decisions, stop conditions | `docs/mission/intent.md` |
| Required outcomes and the canonical contract index | `docs/mission/spec.md` |
| Execution truth, lanes, done-gate, merge authority | `EXECUTION_TRUTH_MODEL.md`, `LANE_MANIFEST_SPEC.md`, `TRUTH_CHECK_SPEC.md`, `.github/workflows/merge-gate.yml` |
| Current program state snapshot | `docs/06_status/CURRENT_STATE.md` (`PROGRAM_STATUS.md` is self-declared superseded) |
| Known debt | `docs/06_status/KNOWN_DEBT.md` |
| Operating lessons | [`plan-lessons.md`](plan-lessons.md) |
| Chronological history through 2026-09-14 | [`plan-history-2026-09.md`](plan-history-2026-09.md) |

**Frozen pending PM architecture review — do not commit to, resume, or design against:** #1491
(`73fb6b76e`, Risk-Scoped Merge Authority), #1492 (`77dea9c8d`, mission-native harness
recalibration), #1495 (`429b0cff9`). They are **not ratified merely because they are implemented**.
The execution and governance system on `main` remains controlling.

---

## 9. Lessons that change how this session should act

Only the few that alter a decision today. The full set is in
[`plan-lessons.md`](plan-lessons.md) — read it on demand, not at session start.

- **A merged repair is not a running repair, and the correction expires the same day.** The
  2026-09-17 edition of this page corrected weeks of "merged but not deployed" warnings by saying
  `main` was running — and by 2026-09-18 that sentence was false again, with a live-path repair
  sitting undeployed behind it. Neither direction is a durable fact. `main` establishes integrated
  code; only a successful `Deploy` run establishes what is executing, and only for the SHA it ran
  at. State which boundary a claim holds at: memory → staging DB → browser → production.
- **A drift conclusion is a reading taken at an instant.** This page concluded "bookkeeping only"
  three times, correctly each time, and a reader trusting that prose later would have believed five
  live-path repairs were in production when none was. Re-run the command; do not trust the number.
- **Verify a derived correction against the running system before writing it.** The 2026-09-14
  three-row correction packet asserted `selectedOffer: present → removed`; the live acceptance query
  measured `jsonb_typeof(metadata->'selectedOffer') = 'null'` on both the repaired path and the
  legacy rows. Under the original ordering that clause would have deleted a key the repaired code
  actually writes. A packet derived offline is a prediction.
- **A dependency on unmerged code is a reason to build on the branch, not to wait for the merge.**
  The staging journey suite was recorded as "cannot be written against `main`" and was then written
  *on* the branch and executed there.
- **An issue's own `file:line` citations are a snapshot.** A lane that implements against them
  without re-measuring implements against a stale repo; two of three citations on UTV2-1838 had
  drifted and the defect behind them was never real.
- **A metric read naively can invert its own verdict.** All three picks in the readiness window
  carried `realEdgeSource: 'sgo'`, which reads as 100% attributed; `SCORE_PROVENANCE_STANDARD.md`
  restricts market-backed to `real-edge` and `consensus-edge`, so the true figure was **0.00%**.
- **A control that fires on everything conveys no information.** 13,462 consecutive failures of
  `governance.awaiting-approval-drift`, with `countIncreased: false` in its own payload.
- **A `kind:runtime` Linear label strands a T2 lane after it has already merged.** truth-check sets
  `runtime_proof_required` from the label, but C6 reads evidence only from
  `manifest.expected_proof_paths`, which `ops:lane-start` derives from the tier — so a T2 manifest
  never declares `evidence.json` and closeout fails post-merge, when no ordinary repair lane can be
  opened. The only admissible exit is `ops:lane-start <ID> --tier T3 --docs-only-fast-path`, which
  returns before the manifest-status check. Declare the bundle at lane-start instead.
- **A squash merge severs a proof's execution anchor.** `sha_binding.verified_source_sha` pointed at
  the pre-squash branch commit, which is in no history afterwards, so `Executor Result Validation`
  refused with compare status `diverged`. Re-anchor to the squash commit — it carries the same tree —
  rather than naming `CI only`, which the validator refuses at T1/T2.
- **Do not choose a lane type to evade a concurrency rule.** That is an operating-model change
  reserved to PM. It has been declined once already and should stay declined.
