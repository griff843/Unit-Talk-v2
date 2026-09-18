# Mission Plan — live

**Owner:** Claude. Rewritten as reality changes. Not a log, not a backlog, not Linear in Markdown.
**Last reconciled against live truth:** 2026-09-18, against `main` `3a07f41b0`
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
| `main` | `3a07f41b0` (a readiness-ledger refresh on top of UTV2-1931, #1604) |
| Deployed release | `961f17c64` — `Deploy` run `35289985486`, succeeded 2026-09-18T00:09Z |
| Drift `deployed..main` | **11 commits, 36 files, 1 migration (already applied), 3 deployment-relevant files** — re-measure, never quote |
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
| Effective deploy mode | **`human-capper`** — the worker runs; ingestor and syndicate machine stay off. There is no `SYNDICATE_MACHINE_MODE` variable; see §7 |
| `worker.heartbeat` | **alive** — every ~6s, max gap 9.4s, zero gaps > 10 min. Window starts when the worker came up, so it is *hours*, not 7 days |
| Open PRs | **10** |
| Active lanes | **zero on `main`** — every tracked manifest in `docs/06_status/lanes/` is terminal. UTV2-1736, UTV2-1827 and UTV2-1919 were listed as "parked" by the previous edition and have **no manifest at all**; they are Linear state, not lane state. The only live lanes are this session's, whose manifests are still untracked |

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
- Drift `deployed..main` is **11 commits / 36 files / 1 migration, already applied in production**
  (`insert_certification_propagation_batch` exists with `p_records jsonb, p_events jsonb`).
  This number moves every time a lane closes — it was 6/32 six hours before this edition.
  Re-run `git diff --name-only 961f17c64..origin/main`; do not quote the figure above.
- **Three of the 36 change what runs**, and all three are Human Capper V1 work:
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
| `ingestor_health` | yes | fail | **containment** — `human-capper` mode sets `_ingestor_autorun=false`, exactly as `parked` does. |
| `worker_outbox_health` | yes | fail | **not containment, and not a sick worker.** Its own evidence reads `worker.heartbeat … (0m, status succeeded)` and then fails on `32 bucket:stale_unknown rows (processing > 5m)`. All 32 sit on four `utv2-1497-canary-*` targets that no worker can claim or reap — see §9. |
| `dead_letter_count` | yes | unknown | partial read yields `unknown` rather than a quiet pass |
| `db_tripwires` | yes | unknown | the observer itself is red, so tripwire state is unproven |

Four non-blocking dimensions (`pnpm_verify`, `scheduled_observer_health`, `proof_coverage`,
`constitution_convergence`) are `fail`/`unknown` and do not gate.

**Only one blocking dimension is containment**, not two. The previous edition said "two blocking
dimensions measure precisely the flags containment sets to `false`" and used that to explain away
both `ingestor_health` and `worker_outbox_health`. That is now measurably wrong for the second one:
the worker *is* running under `human-capper` mode, the ledger records its heartbeat as succeeded,
and the dimension fails on a row-classification defect instead (§9). `ingestor_health` remains
genuine containment and stays red by design. The six-dimension T1 contract measurement is a
separate and stricter instrument — see §8.

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
| **The canonical reference bootstrap is unowned** — #1484 was **closed, not merged** | routine reference-data seeding beyond the operator CLI | nobody. A closed PR nobody replaced is the easiest work to lose; this is a gap, not a resolution. |
| **`P0 Protocol` is blind to `WORK-###`** | tracker-independence exit condition 1 | reserved (merge authority). #1570 is CLOSED, not merged. |

**No longer a blocker**, each verified against the API rather than inferred:

- the missing worker RPC — `insert_certification_propagation_batch` exists in production;
- the Command Center being switched off — it is enabled and deployed;
- **#1592** — **MERGED 2026-09-17T19:53:28Z**. It is UTV2-1923, the PR that introduced
  `human-capper` mode, so the merge this page listed as awaiting a PM decision is the same merge
  that made §7's containment claim false. One event, two stale entries;
- **the `migration` lane type** — and every other singleton type. #1484 closed 2026-09-18T04:00:48Z,
  and **zero** manifests in `docs/06_status/lanes/` are in a non-terminal state, so `migration`,
  `runtime`, `modeling` and `data-canonical` are all admissible. **UTV2-1871** and the Smart Form
  e2e gate are startable; both stay deliberately unstaffed while the single reliability slot is
  held (§6).

---

## 5. Decisions required from Griff

| # | Decision | Reserved under | Blocks |
|---|---|---|---|
| 1 | **Dispatch `Deploy` at `origin/main`.** Recommended. 11 commits, no unapplied migration; the three deployment-relevant files are the recap channel-resolution repair and the `.env.production` key line. **Non-secret success criterion:** the deployed release SHA equals `origin/main`, and a settlement on a delivered pick then produces a recap outbox row. | reserved action 8 | the post-delivery recap; §5 decision 1a below |
| 1a | **Whether to re-open `official-picks` for one bounded recap re-attempt** after that deploy | member-delivery activation (2) | the recap for canary pick `816a84c7` only |
| 2 | **~~Confirm whether the production `SGO_API_KEY` is active.~~ — OWNER-DEFERRED 2026-09-18.** Griff has decided SGO stays intentionally off, to be activated near the end as a bounded data-input dependency. This is **not** a blocker to resolve or route around, and it is **not to be re-raised** until all meaningful provider-independent work is exhausted. The prepared packet (`RESULTS_BACKFILL_AUTHORIZATION_PACKET.md`) stays valid for that later moment. | secrets (4) / paid provider (3) | automated grading, CLV, provider-fed reference and result supply — all **explicitly deferred, not failed** |
| 5 | **Verdict on #1589** (UTV2-1919, T1) | merge authority | #1589 only |
| 6 | **Whether to re-open the `WORK-###` Merge Gate parser work** | merge authority (7) | the tracker workstream only |
| 7 | **#1491 / #1492 architecture review** | merge authority | those two PRs only |
| 8 | **#1451** — production DDL, `verify` red | production DDL (1) | #1451 only |
| 9 | **Direct-`main` prevention control** | branch protection | nothing; the prohibition is already in force |

**Decisions 3 and 4 of the previous edition are gone because they were already resolved**, not
because they were dropped: #1592 merged and #1484 closed. Renumbering was avoided — the remaining
numbers are unchanged so that anything referring to "decision 5" still means #1589.

**Affirmatively not asked for.** No containment change: the effective mode stays `human-capper`,
and every governed delivery target is `killed = true` at the live switch. No provider activation.
No clearing of the canary outbox rows — and specifically **not** the 32 stranded `processing`
rows, whose removal would improve a blocking readiness number by deleting the evidence that the
classification behind it is wrong (§9).

---

## 6. Recommended / executable next wave

**Under existing authority, nothing reserved.** A reserved gate blocks only the work that depends on
it; everything here is independent of §5.

**Standing sequencing directive (owner, 2026-09-18): SGO is intentionally off.** The inactive
provider key is **not** a blocker to route around — it is a deferred, bounded data-input dependency
to activate near the end. Finish everything that can truthfully be completed *without* provider-fed
schedules, offers, results or closing lines; mark the rest **explicitly deferred, not failed**.
Decision 2 in §5 therefore stays surfaced but is **not** to be re-raised or worked around.
Provider-dependent and so deferred: live automated grading, live CLV/closing-line measurement,
provider-fed event and result coverage (readiness dimensions 2, 3, 6 and metric 1 of 4).
Provider-independent and so in scope now: operator decision support (dimension 5), routing-trust
metric 2, runtime health (dimension 1), delivery, recaps, settlement plumbing, onboarding,
reliability, restart/recovery, containment and observability.

1. **Keep the plan and its archives honest.** This lane (UTV2-1934). Startup context must stay
   loadable, and this edition exists because the previous one's §1 and §2 had gone false in six
   places — `main` SHA, drift size, open-PR count, the active-lane list, the migration-lane
   blocker, and the claim that *two* blocking readiness dimensions are containment.
1b. **Command Center operator fields (UTV2-1932).** Readiness dimension 5 is fully
   provider-independent and is the largest closable block on the board: score / routing target /
   edge source in the picks explorer, suppression reasons, a real held-queue page on the
   already-built `getHeldQueue`, and honest CLV rendering in settlement.
1c. **Repair the mirror-image outbox classification (UTV2-1933).** Fixes a vacuous T1 control and
   an unpassable blocking readiness dimension in one change — see §9.
2. **Seed a current event, then submit again through the deployed form** in market shapes not yet
   exercised — a player prop, a total, or a multi-leg slip. The seeding half is now a governed
   one-liner (`scripts/ops/seed-operator-event.ts`, #1602); the submitting half is operator action.
   Condition 1 is a claim about repeatability and only repetition tests it.
3. **Persist the grading skip histogram.** `grading-service.ts` records only `{picksGraded, failed}`,
   discarding the per-pick `outcome: 'skipped'` + `reason` it already computes — so a pass that
   examined 15,000 picks and graded none is byte-identical to one that examined zero. **Owned by
   UTV2-1605**, PM-ratified and routed to Codex. Not unowned; do not re-file.
4. **Repair `governance.awaiting-approval-drift`'s classification.** Built and proven (7/7 behaviour
   drill), filed as **UTV2-1871**. It is **no longer blocked**: #1484 closed and no manifest holds
   the `migration` singleton, so the lane type is available (§4). The repair belongs in the
   classification, never in the data.
5. **Re-home the inadmissible PRs** (#1429, #1491, #1492, #1495, #1496, #1498) through
   `ops:lane-start --readmit-existing-branch` under canonical issues. Renaming an open PR's head
   branch closes it and it will not reopen, so readmission means a replacement PR carrying the same
   diff.

**Not executable, and why:** the recap (needs the deploy — decision 1); automated grading and CLV
(need a trusted provider — decision 2, and note the *second* blocker: all six Track Only picks
carry `eventId: null`, so grading skips them at `event_link_not_found` before results are even
reached). Anything needing a `migration` lane is **no longer** in this list — that type is free.

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

- **Containment is not binary, and has not been since #1592 merged.** `deploy.yml` admits four
  outcomes, not two (`case "$syndicate_machine_mode"`, `:548-567`):

  | mode | `SYNDICATE_MACHINE_ENABLED` | ingestor autorun | worker autorun | delivery targets |
  |---|---|---|---|---|
  | `active` | true | true | true | released; `best-bets` fallback |
  | `parked` | false | false | false | forced `none` |
  | **`human-capper`** | false | false | **true** | forced literally to `official-picks` |
  | anything else | — | — | — | `exit 1` |

  `human-capper` (UTV2-1923) is the bounded unpark earlier editions of this page said did not
  exist: *"parked in every respect except the worker. Provider ingestion, the syndicate machine and
  system picks all stay off."* The sentence it replaces — "a request to unpark ingestion *is* a
  request to activate delivery" — was true before that merge and is now false. It was load-bearing:
  it was the stated reason runtime health could not be measured without a delivery decision.
- **Read the mode from two variables, never one.** There is **no** `SYNDICATE_MACHINE_MODE`
  repository variable. The mode is derived from the `SYNDICATE_MACHINE_ENABLED` secret, then a
  *separate* variable promotes it (`deploy.yml:176-178`):

  ```sh
  if [ "$syndicate_machine_mode" = "parked" ] && [ "${VAR_HUMAN_CAPPER_DELIVERY_ENABLED:-}" = "true" ]; then
    syndicate_machine_mode=human-capper
  ```

  `gh variable list` shows `UNIT_TALK_HUMAN_CAPPER_DELIVERY_ENABLED=true` (non-secret), so the
  **effective mode is `human-capper` and the worker is running**. Reading one name tells you
  nothing; confirm against the newest successful `Deploy` run's
  `{"event":"syndicate_machine_mode.validated","mode":…}` line.
- **The worker is up. Dimension 1's uptime metric is on a clock, not blocked.** Heartbeats live in
  `system_runs` (there is no `system_events` table). `worker.heartbeat` succeeds every ~6s with a
  **max gap of 9.4s and zero gaps over 10 minutes**. But the window begins when the worker came up,
  so it is *hours* long, not the 7 days the threshold names — `where started_at >= now() - '7 days'`
  silently returns whatever exists. Always select `min(started_at)` alongside the aggregate and
  compare it to the window the threshold names. `T1_PRODUCTION_READINESS_CONTRACT.md:53` still
  records "BLOCKED. Worker is DOWN as of 2026-04-30"; that is stale, and "blocked" and "waiting"
  route to different work.
- **`human-capper` still cannot deliver on its own.** Its one enabled target is independently
  killed at the live switch, and `isKilled()` is fail-closed for a target with no row.
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

- **Two controls over one population can be mirror images of the same missing distinction.**
  `worker_outbox_health` is red solely on 32 `processing` rows sitting on four
  `utv2-1497-canary-*` targets — synthetic targets no worker configuration can ever claim, so no
  worker can reap them either. Two pieces of code look at that same population.
  `scripts/ops/readiness-refresh.ts` counts every such row as `bucket:stale_unknown` and fails a
  **blocking** readiness dimension, so the ledger can never pass. The Dimension 1 control in
  `apps/worker/src/t1-proof-utv2-993-worker-restart.test.ts` counts the same rows, prints them, and
  then asserts `assert.ok(true)` — so the test can never fail. Neither asks the one question that
  matters: *could any worker ever claim this row?* One answers no to everything, the other yes to
  everything, and both are wrong in the same place. `isGovernedDeliveryTarget()`
  (`packages/contracts/src/promotion.ts:47`) is the config-independent predicate that partitions
  the population, and one classification repair fixes both. Owned by **UTV2-1933**.
  **The 32 rows are not to be deleted** — deleting them would turn a blocking readiness number
  green by destroying the evidence that the classification behind it is wrong.
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
