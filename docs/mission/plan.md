# Mission Plan — live

**Owner:** Claude. Rewritten as reality changes. Not a log, not a backlog, not Linear in Markdown.
**Last reconciled against live truth:** 2026-09-23, against `main` `df071f24b`
**Archives, read on demand — never at session start:**
[`plan-lessons.md`](plan-lessons.md) (operating lessons) ·
[`plan-history-2026-09.md`](plan-history-2026-09.md) (chronological narrative through 2026-09-14)

This file is startup context. It answers only what a session needs before it can act. It is rebuilt
from live GitHub, runtime and database evidence, not edited forward from its previous text. History
belongs in an archive above.

---

## 1. Current truth

Measured 2026-09-23 against `origin/main`, the GitHub API and production `zfzdnfwdarxucxtaojxm`.

| Fact | Value |
|---|---|
| `main` | `df071f24b` |
| Deployed release | `6685f171c` — `Deploy` run `35807774504`, succeeded 2026-09-23T01:47Z. Five successful deploys since 2026-09-18. |
| Drift `deployed..main` | **23 commits, 99 files, 0 migrations, 9 runtime source files** — re-measure, never quote |
| A deploy run is **still waiting for approval** | `Deploy` run `35596690418`, dispatched 2026-09-21 at `28c0c79af`, is `waiting` on the `canary` environment. That SHA is **older** than the deployed release. See §5 decision 1. |
| Governed pick cohort (`metadata ? 'distributionMode'`) | **9** — 6 `track-only` (all `validated`); 3 `delivery-eligible` (`816a84c7` settled, `ed0ed43c` posted, `2cc92f4b` queued) |
| Settlement records for that cohort | **6**, every one `source = operator`, `confidence = confirmed`, and none is a correction. Unsettled: `dfcd9486` (the Milestone 1 pick), `ed0ed43c` and `2cc92f4b`. |
| Outbox rows for that cohort | **3**, all `discord:official-picks`: `816a84c7` and `ed0ed43c` `sent` (2026-09-18); `2cc92f4b` **`pending` since 2026-09-23 02:21**, `attempt_count = 0` |
| Kill switches | `official-picks`, `best-bets`, `trader-insights`, `exclusive-insights` all `killed = true`. `official-picks` was last toggled 2026-09-19 02:24:44. |
| CLV on settled picks | **null on all 6** |
| Current-game reference data | **1** event in the last 14 days. Newest `events.event_date` is 2026-09-17. |
| Newest `game_results` | **2026-06-30** — the results supply is still empty (SGO owner-deferred, §5 decision 2) |
| Effective deploy mode | **`human-capper`** — the worker runs; ingestor and syndicate machine stay off. See §7. |
| `worker.heartbeat` | alive — newest 2026-09-23 20:03Z |
| Readiness ledger | **RED**, generated 2026-09-23T16:30Z — see §2 |
| Open PRs | **11** |
| Active lanes | This session's `WORK-2026092308` (#1636, T1, awaiting Griff's T1 pair). Every other manifest on `main` is terminal. |

**Milestone 1 is complete.** Griff performed it end to end against the deployed system on
2026-09-09. It was verified by governed read-only production observation, with containment intact
throughout. The evidence narrative is in
[`plan-history-2026-09.md`](plan-history-2026-09.md#milestone-1--the-completion-record).

**Milestone 2 is the active milestone.** §3 gives where each of its six conditions stands.

---

## 2. Production position

**`main` deploys. What is on `main` is not all of what is running.**

- Deployed release: `6685f171c`, `Deploy` run `35807774504`.
- Drift is measured by `git diff --name-only 6685f171c..origin/main`; re-run it, never quote it.
  At this edition it contains **no migration**. The files that change what runs are listed below.

  - `apps/api/src/controllers/override-promotion-controller.ts`
  - `apps/api/src/promotion-service.ts`
  - `apps/command-center/src/app/actions/settle.ts`
  - `apps/command-center/src/app/picks/[id]/page.tsx`
  - `apps/command-center/src/lib/api-error.ts`
  - `apps/command-center/src/lib/data/analytics.ts`
  - `apps/command-center/src/lib/data/queues.ts`
  - `apps/command-center/src/lib/data/snapshot.ts`
  - `apps/command-center/src/lib/promotion-presentation.ts`

  These are Command Center operator-surface work (settle-refusal messages, promotion presentation,
  queues, analytics, the pick page), the settlement-chain reads in `snapshot.ts` (#1635),
  and UTV2-1902's Smart Form best-bets score gate (`promotion-service.ts`, `override-promotion-controller.ts`). None of them changes containment,
  delivery targets or the kill switch.
- The UTV2-1929 recap channel-resolution repair, which the previous edition listed as "merged, not
  running", **is running**: every deploy since 2026-09-18T20:19Z carries it.

**Readiness dimensions**, from `docs/06_status/readiness/readiness-score.json` (2026-09-23T16:30Z):

| Dimension | Blocking | Status | What it means |
|---|---|---|---|
| `deploy_sha_alignment` | yes | fail | Real drift, and it includes runtime files. Closing it is a deploy, which is reserved action 8. |
| `ingestor_health` | yes | fail | **Containment.** The last `ingestor.cycle` was 2026-06-30. `human-capper` mode keeps the ingestor off, and SGO is owner-deferred. |
| `grading_health` | yes | fail | **New since the last edition.** UTV2-1605 (#1621) made the latest `grading.run` report `degraded_stale_input` instead of a bare success. That is honest: there is no result newer than 2026-06-30 to grade against. It is provider-dependent and stays red until SGO. |
| `worker_outbox_health` | yes | **pass** | **Repaired by UTV2-1933** (#1607). The 32 `processing` rows on four `utv2-1497-canary-*` targets are now classified as unclaimable, and they are **still present**, as they must be (§9). |
| `dead_letter_count` | yes | unknown | The reader got 1000 of 1954 rows, because PostgREST caps a response at 1000. The completeness guard refused the partial read. **Fixed in #1637** (merged `4759ff148`); the next scheduled refresh should read all 1954 rows. |
| `db_tripwires` | yes | unknown | **The observer is not broken; the tripwires are firing.** Every run since 2026-09-19 that reached the database (exit 1) executed 12 of 13 checks and tripped 10. The runs from 2026-09-21T11:20Z to 09-22T20:36Z are the exception: they could not connect (`ENOTFOUND tenant/user postgres.zfzdnfwdarxucxtaojxm`, exit 2). The ledger scores this `unknown` only because it reads the run's conclusion, not its receipt. See the note below the table. |

**What the 10 tripped checks are** (run `35883573778`):

- **Size and TOAST, all real.** `system_runs` is 1.3 GB: 3.56M rows since 2026-04-20, growing about
  11.4k rows a day from `worker.heartbeat` alone. `raw_payloads` (694 MB) and `odds_snapshots`
  (427 MB) are more than 99% TOAST and index, left over from ingestion that has been parked since
  2026-06-30.
- **Autovacuum staleness, partly an artifact.** Postgres restarted at 2026-09-23 01:46:41Z, which
  reset the statistics counters. `dead_tup_pct = 49.84%` on `system_runs` is 11,337 dead rows
  against 11,412 *counted* live rows, not the 3.56M the table holds.

Relief for the size findings is retention or archiving, which means production data deletion
(reserved) or the warehouse (§5 decision 10). No agent action closes this dimension.

Four non-blocking dimensions (`pnpm_verify`, `scheduled_observer_health`, `proof_coverage`,
`constitution_convergence`) are `fail` or `unknown` and do not gate.

**Blocking dimensions that containment or SGO deferral keep red, by design:** `ingestor_health`
and `grading_health`. **Provider-independent:** `deploy_sha_alignment` (reserved — Griff dispatches),
`dead_letter_count` (repaired by #1637, awaiting the next refresh), and `db_tripwires` (real volume findings whose relief is reserved). The six-dimension T1 contract measurement is a separate, stricter instrument;
see §8.

---

## 3. Active work

**In flight (this session):**

| PR | Lane | What | State |
|---|---|---|---|
| #1635 | WORK-2026092307, T2 | The dashboard recap and pick pipeline resolve whole correction chains, not a `created_at` window | **merged** `051c474c5`, lane closed |
| #1636 | WORK-2026092308, T1 | `getModelPerformanceReport` counts each pick's **effective** settlement, not its root | resynced onto main at `192da1ca0`; **needs Griff's T1 pair** on that head (§5) |
| #1637 | WORK-2026092309, T2 | The readiness reader pages past the PostgREST 1000-row cap | **merged** `4759ff148`, lane closed |

**Why the settlement-chain lanes matter.** Production holds **12,066** correction rows in
`settlement_records` (10,306 operator, 1,760 grading; created 2026-04-22 to 2026-07-30). Every
reader that took the root row, or resolved a window that cut chains, reported the **original**
result of each of those picks. #1634, #1635 and #1636 close the readers on the product path.

Operator and research scripts still read root-only: `scripts/roi-by-sport.ts`,
`portfolio-review.ts`, `clv-dashboard.ts`, `band-accuracy.ts`, `scoring-provenance.ts`,
`scripts/ops/settlement-drill.ts` and `apps/api/src/scripts/utv2-592-syndicate-proof-gate.ts`. So
does the `v_governed_pick_performance` view, whose repair is DDL and therefore reserved. None of
these feeds a live product surface. Every existing chain has exactly one root, with no branches
and no orphans, measured 2026-09-23.

**Milestone 2, measured against `intent.md`'s six conditions (2026-09-23):**

| # | Condition | State |
|---|---|---|
| 1 | Repeatable submission without per-submission engineering | **The form repeats; the event does not.** 9 governed picks exist, 2 of them since 2026-09-18. Only one event in the last 14 days, so each new game still needs an operator to seed an event first with `scripts/ops/seed-operator-event.ts` (#1602). |
| 2 | Canonical identity and truthful provenance on every pick | **Holds for all 9.** |
| 3 | Grading and settlement on schedule against real results | **Settlement proven, scheduling deferred.** All 6 settlements come from the attested operator route. Automated grading has nothing newer than 2026-06-30 to grade against and now says so (`degraded_stale_input`). It is provider-dependent and **deferred, not failed** (§6). |
| 4 | Statistics computed from persisted history | **Reconciles, minus CLV.** `track-only`: 5 settled, 3W-2L, 17.50 units staked. `delivery-eligible`: 1 settled, 1 loss, 3.50 units. `clvPercent` is null on all 6. The readers now resolve effective settlements (#1634–#1636), so the figure stays correct once corrections begin. |
| 5 | Operator observes through a governed internal surface | **Holds.** The Command Center is deployed. Since 2026-09-18 it has gained operator fields, suppression reasons, a held queue, a governed population predicate, checkpoint recovery and settle-refusal messages (#1606–#1632). |
| 6 | None of it achieved by activating member-facing delivery | **Holds.** Two delivery-eligible picks reached `official-picks` on 2026-09-18 under PM-accepted Human Capper canaries. The switch has been `killed = true` since 2026-09-19, and the third (`2cc92f4b`) waits `pending` behind it. |

**The governed cohort predicate is `metadata ? 'distributionMode'`, and getting it wrong is
silent.** About 93% of `picks` are CI fixtures predating staging isolation.
`v_governed_pick_performance` filters `source = 'board-construction'`, so it cannot contain an
operator submission. Identify genuine submissions *positively*.

---

## 4. Blockers

| Blocker | Blocks | Owner |
|---|---|---|
| **Delivery-eligible pick `2cc92f4b` is queued behind a killed switch** | its delivery, and every later delivery-eligible pick | reserved decision 2 (member-delivery activation) — §5 decision 1a |
| **No current game is selectable** without an operator seeding an event | Milestone 2 condition 1 | operator: `scripts/ops/seed-operator-event.ts` with production credentials |
| **Results supply: no `game_results` after 2026-06-30** | condition 3 (automated grading), condition 4's CLV element, `grading_health` | **owner-deferred** (SGO), §5 decision 2 — not to be routed around |
| **A second data source cannot be admitted by an agent** | any non-SGO route to schedules or results | `PROVIDER_AUTHORITY_LOCK.md` is an active T1 rule; amending it is PM-owned |
| **The canonical reference bootstrap is unowned** — #1484 was closed, not merged | routine reference-data seeding beyond the operator CLI | nobody; a gap, not a resolution |
| **`P0 Protocol` is still blind to `WORK-###`** | tracker-independence exit condition 1 | reserved (merge authority). #1570 taught the **Merge Gate** and the file-scope guard WORK identities; it did not touch P0. |
| **The warehouse is built but not provisioned** | archiving market data off Supabase; the prune that follows it | owner actions in `WAREHOUSE_OBJECT_STORAGE_PROVISIONING.md` — §5 decision 10 |

**No longer a blocker**, each verified rather than inferred:

- **The recap repair is running.** Every deploy since 2026-09-18T20:19Z carries UTV2-1929.
- **`worker_outbox_health`** passes (UTV2-1933, #1607).
- **The Merge Gate WORK-identity parser**: #1570 merged 2026-09-23T03:42Z, so the previous
  edition's decision 6 is resolved.

---

## 5. Decisions required from Griff

| # | Decision | Reserved under | Blocks |
|---|---|---|---|
| 1 | **Reject the stale waiting deploy run `35596690418`** (`28c0c79af`, waiting on `canary` since 2026-09-21). **Recommended.** Approving it would deploy a SHA **older** than the running `6685f171c`, which rolls back everything between them. Then, if wanted, **dispatch `Deploy` at `origin/main`**: 8 runtime files, no migration, no containment change. **Success criterion:** the deployed release SHA equals `origin/main`, and `deploy_sha_alignment` passes at the next ledger refresh. | reserved action 8 | `deploy_sha_alignment`; the Command Center and best-bets work in §2 |
| 1a | **Whether to release delivery-eligible pick `2cc92f4b`**, which has waited `pending` on `official-picks` since 2026-09-23 02:21 behind `killed = true`. The alternative is to leave it queued; it will not deliver on its own. | member-delivery activation (2) | that one pick's delivery |
| 1b | **Settle `ed0ed43c`** (delivered 2026-09-18, still `posted`) through the Command Center once its game is final | operator action, not reserved | condition 4's completeness for the delivered cohort |
| 2 | **SGO — OWNER-DEFERRED 2026-09-18.** SGO stays intentionally off, to be activated near the end as a bounded data-input dependency. **Do not re-raise** until provider-independent work is exhausted. The prepared packet (`RESULTS_BACKFILL_AUTHORIZATION_PACKET.md`) stays valid. | secrets (4) / paid provider (3) | automated grading, CLV, provider-fed reference and result supply — **deferred, not failed** |
| 5 | **Verdict on #1589** (UTV2-1919, T1: an evidence-plane settlement can be corrected), verdict-ready at `fe1243d84` | merge authority | #1589 only |
| 5a | **Verdict on #1636** (WORK-2026092308, T1), verdict-ready at `a440218ef` | merge authority | #1636 only |
| 7 | **#1491 / #1492 architecture review** | merge authority | those two PRs only |
| 8 | **#1451** — production DDL, `verify` red | production DDL (1) | #1451 only |
| 9 | **Direct-`main` prevention control** | branch protection | nothing; the prohibition is already in force |
| 10 | **Warehouse provisioning**: create the bucket and the `UNIT_TALK_WAREHOUSE_*` secrets, create the `warehouse_reader` role and DSN, and decide on pg_cron job 5 `nightly-retention-prune` — all specified in `WAREHOUSE_OBJECT_STORAGE_PROVISIONING.md` and `PRODUCTION_DB_SIZING_AUDIT.md` | secrets (4), production DDL (1) | the warehouse conveyor's first real run |

Decision 6 of the previous edition is gone because it was resolved (#1570 merged). The other
numbers are kept stable, so "decision 5" still means #1589.

**Affirmatively not asked for.** No containment change: the effective mode stays `human-capper`
and every governed delivery target is `killed = true`. No provider activation. No clearing of the
32 stranded canary `processing` rows (§9).

---

## 6. Recommended / executable next wave

**Under existing authority, nothing reserved.** A reserved gate blocks only the work that depends
on it.

**Standing sequencing directive (owner, 2026-09-18): SGO is intentionally off.** Finish everything
that can truthfully be completed *without* provider-fed schedules, offers, results or closing
lines. Mark the rest **explicitly deferred, not failed**.

- **Provider-dependent, so deferred:** live automated grading, live CLV and closing-line
  measurement, provider-fed event and result coverage, and `grading_health`.
- **Provider-independent, so in scope now:** operator decision support, runtime health, delivery
  plumbing, recaps, settlement plumbing, onboarding, reliability, restart and recovery,
  containment and observability.

1. **Land #1636** (§3) once Griff's T1 pair is present on its current head.
2. **Let the ledger read the tripwire receipt, not the run conclusion.** Diagnosed 2026-09-23:
   the observer works and its receipt separates "10 tripped" (exit 1) from "harness could not
   connect" (exit 2). `readiness-refresh.ts` collapses both into `unknown`. Reading the receipt
   would score this dimension an honest `fail` with named checks. That does not turn it green —
   the size findings are real and their relief is reserved.
3. **UTV2-1954, then UTV2-1953, then UTV2-1952** — the runtime-slot queue owned by the parallel
   session: market-adjusted replay fidelity split out of #1630, not waived.
4. **Seed a current event, then submit again through the deployed form** in market shapes not yet
   exercised: a player prop, a total, or a multi-leg slip. Condition 1 is a claim about
   repeatability, and only repetition tests it.
5. **Repair `governance.awaiting-approval-drift`'s classification** (UTV2-1871), which was built
   and proven. The repair belongs in the classification, never in the data.
6. **Re-home the inadmissible PRs** (#1429, #1491, #1492, #1495, #1496, #1498) through replacement
   PRs carrying the same diff. Renaming an open PR's head branch closes it for good.
7. **Root-only settlement readers in operator scripts** (§3) — low priority, since none feeds a
   live surface.

**Not executable, and why:** delivery of `2cc92f4b` (decision 1a); automated grading and CLV
(SGO, decision 2). There is also a *second* blocker: the six Track Only picks carry
`eventId: null`, so grading skips them at `event_link_not_found` before it reaches results.

**On the governance slot.** `intent.md`'s ratified debt policy makes the single
governance/reliability slot a **ceiling, not a quota**. An empty slot alongside moving production
work is a correct state. Record findings in §9 and `plan-lessons.md` rather than filing them. One
defect class gets one canonical issue.

**Lane hygiene owed.** `ops:orchestration-reconcile --current` exits 1 on 24 failures. They are
leases and Linear states that closeouts never released on UTV2-1892/1950/1924/1948/1708, and
WORK-### leases that Linear cannot see. Release a terminal lane's lease with
`pnpm ops:lease release --issue <ID> --actor claude --reason "<why>"` as part of every closeout.
Every closeout this session leaked its lease.

---

## 7. Containment and production safety

**Containment is intact and unchanged, and no change to it is requested.**

- **Containment has four modes, not two.** `deploy.yml`'s `case "$syndicate_machine_mode"` admits
  these:

  | mode | `SYNDICATE_MACHINE_ENABLED` | ingestor autorun | worker autorun | delivery targets |
  |---|---|---|---|---|
  | `active` | true | true | true | released; `best-bets` fallback |
  | `parked` | false | false | false | forced `none` |
  | **`human-capper`** | false | false | **true** | forced literally to `official-picks` |
  | anything else | — | — | — | `exit 1` |

- **Read the mode from two variables, never one.** There is **no** `SYNDICATE_MACHINE_MODE`
  repository variable. The mode is derived from the `SYNDICATE_MACHINE_ENABLED` secret. A separate
  variable, `UNIT_TALK_HUMAN_CAPPER_DELIVERY_ENABLED=true`, then promotes `parked` to
  `human-capper`. Confirm against the newest successful `Deploy` run's
  `{"event":"syndicate_machine_mode.validated","mode":…}` line.
- **`human-capper` cannot deliver on its own.** Its one enabled target is independently killed at
  the live switch, and `isKilled()` fails closed for a target with no row. `2cc92f4b` waiting
  `pending` is that mechanism working.
- **Grading is deliberately not contained.** `deploy.yml` sets `UNIT_TALK_GRADING_CRON_AUTORUN=true`
  outside the mode case statement.
- **Non-delivery is enforced, not merely absent.** `isTrackOnlyPickMetadata` gates eight
  independent modules on `main` (submit, distribution enqueue, run audit, requeue, retry, recap,
  health, settlement), and UTV2-1672 mutation-tested the original set. Every `track-only` pick
  still has zero outbox rows.
- **Member-delivery activation is separately reserved** and is explicitly not part of Milestone 2.
- **Standing prohibition:** ordinary direct-`main` bypass. All planned work lands via PR on green
  CI. One incident remains open and unrecorded: the 2026-09-02 push `717b46971`, which `Direct Main
  Push Guard` flagged red (run `33683588651`) but could not prevent, because `enforce_admins: false`
  exempts an admin credential. Prevention is decision 9.

Branch protection on `main`: four required checks — `verify`, `Executor Result Validation`,
`Merge Gate`, `P0 Protocol`. `strict: true`, `enforce_admins: false`.

---

## 8. Authoritative pointers

Live evidence overrides every snapshot, including this page.

| Question | Authority |
|---|---|
| Is Unit Talk production-ready? | `docs/05_operations/T1_PRODUCTION_READINESS_CONTRACT.md` — the **only** readiness threshold |
| The six-dimension contract, actually measured | `docs/05_operations/READINESS_MEASUREMENT_2026-09-14.md` — `overall_pass: false`; an **UNKNOWN blocks the gate exactly as a FAIL does**. It is nine days old, so re-measure before citing a dimension. |
| What Command Center is and must do | `docs/03_product/COMMAND_CENTER_PRODUCT_CONTRACT.md` — sole authority. `HUMAN_CAPPER_V1_LIFECYCLE_HANDOFF.md` is now a **deprecated pointer**; its content is archived under `docs/archive/command-center/`. |
| Results backfill, prepared and reserved | `docs/05_operations/RESULTS_BACKFILL_AUTHORIZATION_PACKET.md` |
| Warehouse provisioning (owner actions) | `docs/05_operations/WAREHOUSE_OBJECT_STORAGE_PROVISIONING.md`, `PRODUCTION_DB_SIZING_AUDIT.md` |
| Reference-data coverage | `docs/05_operations/REFERENCE_DATA_AUDIT_2026-09-13.md` |
| Provider coverage limits | `docs/05_operations/PROVIDER_KNOWLEDGE_BASE.md` §5 |
| Mission intent, reserved decisions, stop conditions | `docs/mission/intent.md` |
| Required outcomes and the canonical contract index | `docs/mission/spec.md` |
| Execution truth, lanes, done-gate, merge authority | `EXECUTION_TRUTH_MODEL.md`, `LANE_MANIFEST_SPEC.md`, `TRUTH_CHECK_SPEC.md`, `.github/workflows/merge-gate.yml` |
| Current program state snapshot | `docs/06_status/CURRENT_STATE.md` |
| Known debt | `docs/06_status/KNOWN_DEBT.md` |
| Operating lessons | [`plan-lessons.md`](plan-lessons.md) |

**Frozen pending PM architecture review — do not commit to, resume, or design against:** #1491
(Risk-Scoped Merge Authority), #1492 (mission-native harness recalibration), #1495. Being
implemented does not ratify them.

---

## 9. Lessons that change how this session should act

Only the few that alter a decision today. The full set is in
[`plan-lessons.md`](plan-lessons.md).

- **`resolveEffectiveSettlement` accepts a lone record without reading `corrects_id`.** For more
  than one record it walks root to tip and ignores any row the walk does not reach. A reader that
  hands it a window, or a partial chain, therefore gets an answer rather than a refusal. Accept a
  resolution only when every `corrects_id` target is present **and** `correction_depth + 1`
  equals the row count. A test built on a single in-window correction cannot fail on the broken
  reader, because the short-circuit hides it.
- **A limit is not a capacity.** PostgREST caps every response at `max-rows` (1000), whatever
  `.limit()` asks for. A reader whose constant says 20000 read 1000 of 1954, and only a
  completeness guard stopped it from passing a blocking dimension on half the population. Any
  PostgREST read that can exceed 1000 rows pages with an ordered `range`. A paging test needs a
  fake that also serves unordered reads unstably, or dropping the `ORDER BY` passes.
- **The 32 stranded canary `processing` rows are not to be deleted.** UTV2-1933 now classifies
  them as unclaimable, and `worker_outbox_health` passes with them present. Deleting them would
  have made the dimension green by destroying the evidence the classification was built on.
- **A merged repair is not a running repair**, and the correction expires quickly in both
  directions. The 2026-09-18 edition said the recap repair was merged and not running; within a
  day it was running. Only a successful `Deploy` run establishes what is executing, and only for
  its SHA.
- **A waiting deploy run is not a harmless leftover.** `35596690418` has waited on `canary` since
  2026-09-21 at a SHA older than the running release. Approving it would roll production back.
  Read `status` alongside `conclusion` when listing deploys.
- **A drift conclusion is a reading taken at an instant.** Re-run the command; do not trust the
  number.
- **Verify a derived correction against the running system before writing it.** A packet derived
  offline is a prediction.
- **A metric read naively can invert its own verdict.** A `realEdgeSource: 'sgo'` reads as
  attributed; `SCORE_PROVENANCE_STANDARD.md` says it is not.
- **Do not choose a lane type to evade a concurrency rule.** That is an operating-model change
  reserved to PM.
