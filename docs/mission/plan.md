# Mission Plan — live

**Owner:** Claude. Rewritten as reality changes. Not a log, not a backlog, not Linear in Markdown.
**Last reconciled against live truth:** 2026-09-27, against `main` `f8b016cd7`
**Archives, read on demand — never at session start:**
[`plan-lessons.md`](plan-lessons.md) (operating lessons) ·
[`plan-history-2026-09.md`](plan-history-2026-09.md) (chronological narrative through 2026-09-14)

This file is startup context. It answers only what a session needs before it can act. It is rebuilt
from live GitHub, runtime and database evidence, not edited forward from its previous text. History
belongs in an archive above.

---

## 1. Current truth

Measured 2026-09-27 against `origin/main`, the GitHub API and production `zfzdnfwdarxucxtaojxm`
(read-only SQL).

| Fact | Value |
|---|---|
| `main` | `f8b016cd7` |
| Deployed release | **Still `6685f171c`** — `Deploy` run `35807774504`, succeeded 2026-09-23T01:47Z. No deploy since. |
| Drift `deployed..main` | **109 commits, 348 files, 0 migrations, 21 runtime source files** — re-measure, never quote |
| Cron job 5 `nightly-retention-prune` | **Inactive** (since 2026-09-24, Griff-authorized). **Do not re-enable it** without PM approval of a verified replacement retention design. Job 2 `awaiting-approval-drift-monitor` is the only active job. |
| Governed pick cohort (`metadata ? 'distributionMode'`) | **9, unchanged since 2026-09-23** — 6 `track-only` (all `validated`); 3 `delivery-eligible` (`816a84c7` settled, `ed0ed43c` posted, `2cc92f4b` queued). No pick has been submitted since 2026-09-23 02:20Z. |
| Settlement records for that cohort | **6**, all operator-sourced. Unsettled: `dfcd9486` (the Milestone 1 pick), `ed0ed43c`, `2cc92f4b`. |
| Outbox rows for that cohort | **3**, all `discord:official-picks`: `816a84c7` and `ed0ed43c` `sent`; `2cc92f4b` **`pending` since 2026-09-23 02:21**, `attempt_count = 0` |
| Whole outbox | 5750 rows: 3760 `sent`, 1954 `dead_letter`, 32 `processing` (the stranded canary rows, §9), 4 `pending` |
| Kill switches | `official-picks`, `best-bets`, `trader-insights`, `exclusive-insights` all `killed = true`; `official-picks` last toggled 2026-09-19 02:24:44 |
| CLV on settled picks | **null on all 6** |
| Current-game reference data | **1** event in the last 14 days. Newest `events.event_date` is still 2026-09-17. |
| Newest `game_results` | **2026-06-30** — SGO owner-deferred (§5 decision 2) |
| Settlement corrections in production | **12,066** rows with `corrects_id` |
| Effective deploy mode | **`human-capper`** — the worker runs; ingestor and syndicate machine stay off. See §7. |
| `worker.heartbeat` | alive — newest 2026-09-27 18:33Z. `grading.run` fires on schedule (newest 18:40Z). |
| `system_runs` | 1327 MB |
| Readiness ledger | **RED**, generated 2026-09-27T16:42Z — see §2 |
| Open PRs | **10**: #1671 (mine, T1), #1667 (Codex, Command Center), and the frozen or inadmissible #1556, #1505, #1498, #1495, #1492, #1491, #1451, #1429 |
| Lane manifests | 831 `done`, 28 `closed`, **26 `merged`** (PR merged, closeout never completed), 1 `superseded`, 1 `in_review` (WORK-2026092705, closeout pending), 1 `started` (this edition's lane). Count with `jq .status docs/06_status/lanes/*.json`; never assume terminal. |

**Milestone 1 is complete.** Griff performed it end to end against the deployed system on
2026-09-09, verified by governed read-only production observation with containment intact. The
evidence narrative is in [`plan-history-2026-09.md`](plan-history-2026-09.md#milestone-1--the-completion-record).

**Milestone 2 is the active milestone.** §3 gives where each of its six conditions stands.

---

## 2. Production position

**`main` deploys. What is on `main` is not what is running — and the gap is now large.**

- Deployed release: `6685f171c`. Drift is measured by `git diff --name-only 6685f171c..origin/main`;
  re-run it, never quote it. At this edition it contains **no migration** and 21 runtime source
  files across `apps/api`, `apps/worker`, `apps/command-center`, `packages/contracts`,
  `packages/db` and `packages/domain`.
- What that drift carries (merged 2026-09-23 → 09-27, not running):
  - **Settlement truth.** Readers resolve whole correction chains: #1634–#1636, #1589
    (evidence-plane correction), #1662 (operator research scripts), #1667 pending (Command Center).
  - **Promotion.** UTV2-1902's Smart Form best-bets score gate (#1630) and UTV2-1954's
    market-adjusted replay from the recorded policy (#1654).
  - **Worker and health.** A deliberate delivery skip is logged (#1651); `/health` reads the whole
    zombie population (#1647).
  - **Command Center.** Settle-refusal messages (#1632), delivery-history pagination (#1658),
    promotion presentation, queues and analytics.
  - **Host.** Disk reclamation and log rotation on the production host (#1645) take effect only
    through a deploy.
  - None of it changes containment, delivery targets or the kill switch.

**Readiness dimensions**, from `docs/06_status/readiness/readiness-score.json` (2026-09-27T16:42Z):

| Dimension | Blocking | Status | What it means |
|---|---|---|---|
| `deploy_sha_alignment` | yes | fail | Real drift, including runtime files. Closing it is a deploy — reserved action 8. |
| `ingestor_health` | yes | fail | **Containment.** No `ingestor.cycle` since 2026-06-30; `human-capper` keeps the ingestor off, and SGO is owner-deferred. |
| `grading_health` | yes | fail | Grading runs on schedule and honestly reports `degraded_stale_input`: there is no result newer than 2026-06-30. Provider-dependent; stays red until SGO. |
| `worker_outbox_health` | yes | **pass** | UTV2-1933 classifies the 32 stranded canary `processing` rows as unclaimable; they remain present, as they must (§9). |
| `dead_letter_count` | yes | **pass** | **Repaired** by #1637: the reader pages past PostgREST's 1000-row cap and now reads all 1954 rows. |
| `db_tripwires` | yes | **fail** | **Now an honest fail**, not `unknown` (#1639 reads the tripwire receipt). The fired checks are real size findings: `system_runs` 1.3 GB, and `raw_payloads` / `odds_snapshots` left over from parked ingestion. Relief is archiving then pruning — §5 decision 10. |

Non-blocking: `pnpm_verify`, `scheduled_observer_health`, `proof_coverage` fail;
`constitution_convergence` is `unknown`. They do not gate.

**Blocking dimensions kept red by design:** `ingestor_health`, `grading_health` (containment / SGO).
**Provider-independent and reserved:** `deploy_sha_alignment` (deploy, decision 1) and
`db_tripwires` (warehouse provisioning, decision 10). No agent action closes any remaining blocking
dimension. The six-dimension T1 contract measurement is a separate, stricter instrument; see §8.

---

## 3. Active work

**In flight:**

| PR | Lane | What | State |
|---|---|---|---|
| #1671 | WORK-2026092706, T1 | Every CI job that resets the shared staging database (`seed-staging-fixtures.ts`) joins one concurrency group, so one run's reset can no longer wipe another run's live proof. Proven at runtime (a dispatched proof sat `pending` and started seconds after the PR's finished). | head `089c72807`, all required checks green except the Merge Gate; **needs Griff's T1 pair** (§5 decision 5) |
| #1667 | WORK-2026092606, T2, **Codex** | Command Center settlement truth: complete paged history, resolved correction chains, exact pagination | Codex-owned. Do not touch `apps/command-center/**` or its lane files. |
| — | WORK-2026092705 | `runtime:health` judges the whole outbox with the canonical dead-letter rule (#1672) | **merged** `f8b016cd7`; closeout dispatches once main CI is green |

**Merged since the 2026-09-23 edition (#1570–#1672), grouped:**

- **Settlement correctness.** #1589, #1634–#1636, #1662. Every reader on the product path, and the
  operator research scripts, now resolve the effective settlement rather than the root. The
  `v_governed_pick_performance` view is still root-only; its repair is DDL and reserved.
- **Readiness and health observability.** #1637 (paged reader), #1639 (tripwire receipt), #1641
  (partition-aware size tripwire), #1647 (`/health` zombies), #1666 / #1669 (pipeline-health
  monitor judges the deployed worker and the whole outbox), #1672 (`runtime:health`).
- **Warehouse.** #1627, #1631, #1643, #1646, #1650, #1659. Built, fail-closed and redacting;
  backfill runner ready; the `season: 'all'` key defect is fixed (`resolveSeason`). **Nothing is
  provisioned** — see decision 10.
- **Promotion.** #1630 (UTV2-1902), #1654 (UTV2-1954).
- **Tracker independence.** #1570, #1644, #1649, #1660, #1663: WORK identities are admitted by the
  Merge Gate, the file-scope guard, Tier Label Check and preflight without Linear; lane-start
  produces a lane that can close first time.
- **Operator access.** #1652, a governed loopback bridge to the production Command Center over SSH
  exec. `cc-proxy` is not retired, by instruction.
- **Staging.** #1655 drained leaked CI fixtures from the staging best-bets board.

**Milestone 2, measured against `intent.md`'s six conditions (2026-09-27):**

| # | Condition | State |
|---|---|---|
| 1 | Repeatable submission without per-submission engineering | **The form repeats; the event does not.** 9 governed picks; none since 2026-09-23. One event in 14 days, so each new game still needs an operator to seed an event with `scripts/ops/seed-operator-event.ts`. |
| 2 | Canonical identity and truthful provenance on every pick | **Holds for all 9.** |
| 3 | Grading and settlement on schedule against real results | **Settlement proven, automated grading deferred.** All 6 settlements are attested operator settlements. Grading runs and reports `degraded_stale_input` — provider-dependent, **deferred, not failed**. |
| 4 | Statistics computed from persisted history | **Reconciles, minus CLV.** `track-only`: 5 settled, 3W-2L, 17.50 units. `delivery-eligible`: 1 settled, 1 loss, 3.50 units. CLV null on all 6. The readers resolve effective settlements, but that code is **not deployed** (§2). |
| 5 | Operator observes through a governed internal surface | **Holds.** Command Center is deployed and reachable through the governed bridge (#1652). |
| 6 | None of it achieved by activating member-facing delivery | **Holds.** `official-picks` has been `killed = true` since 2026-09-19; `2cc92f4b` waits `pending` behind it. |

**The governed cohort predicate is `metadata ? 'distributionMode'`, and getting it wrong is
silent.** About 93% of `picks` are CI fixtures predating staging isolation.
`v_governed_pick_performance` filters `source = 'board-construction'`, so it cannot contain an
operator submission. Identify genuine submissions *positively*.

---

## 4. Blockers

| Blocker | Blocks | Owner |
|---|---|---|
| **109 commits of merged work are not running** | condition 4's correctness in production, `deploy_sha_alignment`, the host disk repair | reserved action 8 — §5 decision 1 |
| **Delivery-eligible pick `2cc92f4b` is queued behind a killed switch** | its delivery, and every later delivery-eligible pick | member-delivery activation — §5 decision 1a |
| **No current game is selectable** without an operator seeding an event | Milestone 2 condition 1 | operator: `scripts/ops/seed-operator-event.ts` with production credentials |
| **Results supply: no `game_results` after 2026-06-30** | condition 3 (automated grading), CLV, `grading_health` | **owner-deferred** (SGO), §5 decision 2 — not to be routed around |
| **A second data source cannot be admitted by an agent** | any non-SGO route to schedules or results | `PROVIDER_AUTHORITY_LOCK.md` is an active T1 rule; amending it is PM-owned |
| **The canonical reference bootstrap is unowned** — #1484 was closed, not merged | routine reference-data seeding beyond the operator CLI | nobody; a gap, not a resolution |
| **`P0 Protocol` is still blind to `WORK-###`** | tracker-independence exit condition 1 | reserved (merge authority) |
| **The warehouse is built but not provisioned** | archiving off Supabase; any prune; `db_tripwires` | owner actions in `WAREHOUSE_OBJECT_STORAGE_PROVISIONING.md` — §5 decision 10 |
| **Staging CI runs can corrupt each other's proof** until #1671 lands | intermittent red `verify` on concurrent T1/DB pushes — stagger pushes meanwhile | Griff's T1 pair on #1671 |

**No longer a blocker**, each verified: `dead_letter_count` passes (#1637); `db_tripwires` is an
honest fail rather than an unreadable `unknown` (#1639); the warehouse key defect is fixed (#1650);
#1589 and #1636 are merged.

---

## 5. Decisions required from Griff

| # | Decision | Reserved under | Blocks |
|---|---|---|---|
| 1 | **Dispatch `Deploy` at `origin/main`.** 109 commits, 21 runtime source files, **no migration, no containment change**. Recommended: it is the only way the settlement-truth, promotion and host-disk repairs in §2 begin to run. **Success criterion:** the deployed release SHA equals `origin/main`, and `deploy_sha_alignment` passes at the next ledger refresh. | reserved action 8 | `deploy_sha_alignment`; everything in §2 |
| 1a | **Whether to release delivery-eligible pick `2cc92f4b`**, `pending` on `official-picks` since 2026-09-23 02:21 behind `killed = true`. Left alone, it will never deliver. | member-delivery activation (2) | that pick's delivery |
| 1b | **Settle `ed0ed43c`** (delivered 2026-09-18, still `posted`) through the Command Center once its game is final | operator action, not reserved | condition 4 completeness |
| 2 | **SGO — OWNER-DEFERRED 2026-09-18.** Do not re-raise until provider-independent work is exhausted. `RESULTS_BACKFILL_AUTHORIZATION_PACKET.md` stays valid. | secrets (4) / paid provider (3) | automated grading, CLV, provider-fed supply — **deferred, not failed** |
| 5 | **Verdict on #1671** (WORK-2026092706, T1: serialize the staging-resetting CI jobs): `t1-approved` label and a `pm-verdict/v1` APPROVED comment on head `089c72807`. If it falls BEHIND and is resynced, the verdict must be re-issued on the new head. | merge authority | #1671 only |
| 7 | **#1491 / #1492 architecture review** | merge authority | those two PRs only |
| 8 | **#1451** — production DDL, `verify` red | production DDL (1) | #1451 only |
| 9 | **Direct-`main` prevention control** (`enforce_admins: false`) | branch protection | nothing; the prohibition is already in force |
| 10 | **Warehouse provisioning.** Owner sequence and verification matrix: `WAREHOUSE_OBJECT_STORAGE_PROVISIONING.md` §6. Then the prepared `warehouse_reader` grants (DDL) and the `warehouse-archive` environment's secrets. The historical backfill (`WAREHOUSE_HISTORICAL_BACKFILL_PLAN.md`) is a separate reserved start. Code is ready on `main`. | secrets (4), production DDL (1) | the conveyor's first real run; the backfill; any relief for `db_tripwires` |

Decisions 5 (#1589) and 5a (#1636) of the previous edition are gone: both PRs merged. Number 5 now
means #1671. The other numbers are kept stable.

**Affirmatively not asked for.** No containment change: the effective mode stays `human-capper`
and every governed delivery target is `killed = true`. No provider activation. No clearing of the
32 stranded canary `processing` rows (§9). No re-enabling of cron job 5.

---

## 6. Recommended / executable next wave

**Under existing authority, nothing reserved.** A reserved gate blocks only the work that depends
on it.

**Standing sequencing directive (owner, 2026-09-18): SGO is intentionally off.** Finish everything
that can truthfully be completed *without* provider-fed schedules, offers, results or closing
lines. Mark the rest **explicitly deferred, not failed**.

1. **Land #1671** once Griff's T1 pair is present on its head; until then, stagger pushes that run
   staging DB jobs.
2. **Close WORK-2026092705** through `post-merge-lane-close.yml` once main CI is green, and release
   its lease.
3. **UTV2-1953 stays queued** by PM instruction; UTV2-1952 follows it. Do not start either
   without a PM release.
4. **Seed a current event, then submit again through the deployed form** in an unexercised market
   shape (player prop, total, multi-leg). Condition 1 is a claim about repeatability; only
   repetition tests it. Needs an operator with production credentials.
5. **Repair `governance.awaiting-approval-drift`'s classification** (UTV2-1871). The repair belongs
   in the classification, never in the data.
6. **Re-home the inadmissible PRs** (#1429, #1491, #1492, #1495, #1498) through replacement PRs
   carrying the same diff. Renaming an open PR's head branch closes it for good. #1491 / #1492
   stay frozen pending PM review regardless.
7. **Correct the stale `LIVE_TARGETS` lists.** `scripts/pipeline-health.ts:311` and
   `apps/worker/src/replay-failed-delivery.ts:11` both hold `['discord:canary', 'discord:best-bets']`.
   Neither names `discord:official-picks`, the only target `human-capper` delivers to. Read both
   consumers before changing either; the worker file is runtime code.

**Not executable, and why:** delivery of `2cc92f4b` (decision 1a); automated grading and CLV (SGO,
decision 2). The six Track Only picks also carry `eventId: null`, so grading skips them at
`event_link_not_found` before it reaches results. Command Center (`apps/command-center/**`) belongs
to Codex's #1667 while it is open.

**On the governance slot.** A ceiling, not a quota. Record findings here and in
`plan-lessons.md` rather than filing them. One defect class gets one canonical issue.

**Findings recorded 2026-09-27, not filed** (each affects tooling, none blocks production):

- **A GitHub concurrency group holds one pending job.** A newer arrival cancels the older pending
  one even with `cancel-in-progress: false`. #1671's first revision grouped every `staging-ci`
  job and cancelled `verify`'s own DB proof; it now groups only the resetting jobs, and
  `workflow-hardening.test.ts` enforces "resetters in, nobody else".
- **`Return review packet` is red on every WORK-### PR.** It is not required, and no merge has
  been blocked by it.
- **The push-triggered closeout ignores WORK identities.** WORK lanes close only through
  `workflow_dispatch` of `post-merge-lane-close.yml` without the `pr` input.
- **The orchestrator cannot approve its own PR** (`gh pr review --approve` is refused). T2 WORK
  lanes merge on the executor-result path of the Merge Gate, which is what `merge-gate.yml`
  already admits.
- **The verify-semaphore SIGTERM test is flaky** under load; a rerun of the whole run clears it.

**Lane hygiene owed.** 26 manifests sit at `merged`. Release a terminal lane's lease with
`pnpm ops:lease release --issue <ID> --actor claude --reason "<why>"` as part of every closeout.

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
| The six-dimension contract, actually measured | `docs/05_operations/READINESS_MEASUREMENT_2026-09-14.md` — `overall_pass: false`; an **UNKNOWN blocks the gate exactly as a FAIL does**. It is thirteen days old, so re-measure before citing a dimension. |
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
- **A waiting deploy run is not a harmless leftover.** `35596690418` waited on `canary` at a SHA
  older than the running release; approving it would have rolled production back. It was rejected
  2026-09-24. Read `status` alongside `conclusion` when listing deploys.
- **A drift conclusion is a reading taken at an instant.** Re-run the command; do not trust the
  number.
- **Verify a derived correction against the running system before writing it.** A packet derived
  offline is a prediction.
- **A metric read naively can invert its own verdict.** A `realEdgeSource: 'sgo'` reads as
  attributed; `SCORE_PROVENANCE_STANDARD.md` says it is not.
- **Do not choose a lane type to evade a concurrency rule.** That is an operating-model change
  reserved to PM.
