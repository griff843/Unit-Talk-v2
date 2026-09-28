# Mission Plan — live

**Owner:** Claude. Rewritten as reality changes. Not a log, not a backlog, not Linear in Markdown.
**Last reconciled against live truth:** 2026-09-28, against `main` `3ba97e758` and deployed release `063a9f36a`
**Archives, read on demand — never at session start:**
[`plan-lessons.md`](plan-lessons.md) (operating lessons) ·
[`plan-history-2026-09.md`](plan-history-2026-09.md) (chronological narrative through 2026-09-14)

This file is startup context. It answers only what a session needs before it can act. It is rebuilt
from live GitHub, runtime and database evidence, not edited forward from its previous text. History
belongs in an archive above.

---

## 1. Current truth

Measured 2026-09-28 against `origin/main`, the GitHub API and production `zfzdnfwdarxucxtaojxm`
(read-only SQL).

| Fact | Value |
|---|---|
| `main` | `3ba97e758` (a readiness-ledger refresh on top of `063a9f36a`) |
| Deployed release | **`063a9f36a`** — `Deploy` run `36426213004`, succeeded 2026-09-28 ~14:40Z, canary and production approved by Griff, rollback target `fb77e5508` unused. The previous release, `fb77e5508`, deployed the same morning (run `36365836032`). |
| Drift `deployed..main` | **No code.** One file, `readiness-score.json`. Re-measure with `git diff --name-only 063a9f36a..origin/main`; never quote. |
| Cron job 5 `nightly-retention-prune` | **Inactive** (since 2026-09-24, Griff-authorized). **Do not re-enable it** without PM approval of a verified replacement retention design. Job 2 `awaiting-approval-drift-monitor` is the only active job. |
| Governed pick cohort (`metadata ? 'distributionMode'`) | **11** — 7 `track-only` (all `validated`); 4 `delivery-eligible`: `816a84c7` settled, `ed0ed43c` posted, and **`2cc92f4b` and `c12f1e2f` queued**. |
| Settlement records for that cohort | **6**, all operator-sourced |
| Queued behind the killed switch | `2cc92f4b` (outbox `68f922a2`, `pending` since 2026-09-23 02:21) and `c12f1e2f` (outbox `5005f461`, `pending` since 2026-09-28 02:13). Both `attempt_count = 0`, no receipts. |
| Whole outbox | 5751 rows: 3760 `sent`, 1954 `dead_letter`, 32 `processing` (the stranded canary rows, §9), 5 `pending` |
| Kill switches | `official-picks`, `best-bets`, `trader-insights`, `exclusive-insights` all `killed = true`; `official-picks` last toggled 2026-09-19 02:24:44 |
| CLV on settled picks | **null on all 6** |
| Current-game reference data | **2** events in the last 14 days, both operator-seeded: Lions @ Bills (2026-09-17) and Eagles @ Bears (2026-09-28). |
| Newest `game_results` | **2026-06-30** — SGO owner-deferred (§5 decision 2) |
| Effective deploy mode | **`human-capper`**, confirmed by run `36426213004`'s `syndicate_machine_mode.confirmed` line: ingestor autorun and scheduling off, worker on, one enabled target (`official-picks`), `killSwitchEngaged: true`. See §7. |
| `worker.heartbeat` | alive — newest 2026-09-28 15:34Z. `grading.run` fires on schedule (newest 15:31Z). |
| Readiness ledger | **RED**, generated 2026-09-28T13:23Z — **before** the deploy, so its `deploy_sha_alignment: fail` predates `063a9f36a`. Re-read after the next refresh. |
| Open PRs | **9**: #1678 (Codex, UTV2-1370 warehouse retention, **T1 with a migration**) and the frozen or inadmissible #1556, #1505, #1498, #1495, #1492, #1491, #1451, #1429 |
| Lane manifests | 838 `done`, 28 `closed`, **27 `merged`** (26 old plus WORK-2026092606, accepted closeout debt), 1 `superseded`, 2 `started` (UTV2-1370, Codex; and this edition's lane). Count with `jq .status docs/06_status/lanes/*.json`; never assume terminal. |

**Milestone 1 is complete.** Griff performed it end to end against the deployed system on
2026-09-09, verified by governed read-only production observation with containment intact. The
evidence narrative is in [`plan-history-2026-09.md`](plan-history-2026-09.md#milestone-1--the-completion-record).

**Milestone 2 is the active milestone.** §3 gives where each of its six conditions stands.

---

## 2. Production position

**`main` and production agree.** For the first time since 2026-09-23 the running code is `main`'s
code: the deploy of `063a9f36a` carried the 109-commit backlog (settlement-truth readers, promotion,
`/health` zombies, host disk reclamation, Command Center settlement truth from #1667) and the Track
Only containment repair below. Only a ledger refresh sits on top.

**The Track Only containment defect is fixed and accepted in production.**

- **The defect.** An allow-listed capper's explicit Track Only request was widened server-side to
  `delivery-eligible` and queued for delivery. Griff's real pilot pick `c12f1e2f` (2026-09-28 02:13Z)
  was queued that way; only the killed `official-picks` switch stopped delivery.
- **The fix.** #1675 (WORK-2026092802, T1, Griff's `t1-approved` + PM verdict), `TRACK_ONLY_INTENT_GUARD`
  in `handlers/submit-pick.ts`. `track-only` or no mode persists Track Only with a server-recorded
  refusal; `delivery-eligible` needs the server allow-list or is refused; anything else is refused.
  Proven by a regression test that fails on the old handler, a mutation drill, and a live staging
  suite (3/3). Lanes WORK-2026092802/03/04 are `done`.
- **Production acceptance, 2026-09-28.** Griff submitted pick `92789b58` (Yankees ML −143, Track Only)
  through the deployed form, authenticated as `griff843`. Production DB: submission and pick both
  `track-only`; `deliveryAuthorization` `refused` / `track-only-requested`; status `validated`, one
  lifecycle event (`→ validated`); **0 outbox, 0 receipts, 0 execution intents**; the only pick created
  since the deploy; no outbox row or receipt created anywhere since. Command Center (signed in,
  through the bridge, observed by Codex and checked against a screenshot) shows `Track Only —
  Verified: no outbox row, no receipt, no delivery attempt`, and the pick is absent from outbox,
  delivery, review, exceptions and settlement surfaces. Kill switches and both queued picks are
  byte-identical to the pre-deploy baseline.

**Readiness dimensions**, from `docs/06_status/readiness/readiness-score.json` (generated before the
deploy — re-read):

| Dimension | Blocking | Status | What it means |
|---|---|---|---|
| `deploy_sha_alignment` | yes | fail *(stale)* | Measured before the deploy. Code drift is now zero; expect a pass at the next refresh, and re-measure rather than assume. |
| `ingestor_health` | yes | fail | **Containment.** `human-capper` keeps the ingestor off; SGO is owner-deferred. |
| `grading_health` | yes | fail | Grading runs on schedule and honestly reports `degraded_stale_input`: no result newer than 2026-06-30. Provider-dependent. |
| `worker_outbox_health` | yes | **pass** | The 32 stranded canary `processing` rows are classified unclaimable and remain present (§9). |
| `dead_letter_count` | yes | **pass** | The paged reader reads all 1954 rows (#1637). |
| `db_tripwires` | yes | fail | Real size findings (`system_runs`, parked-ingestion tables). Relief is archive-then-prune — §5 decision 10. |

Non-blocking: `pnpm_verify`, `scheduled_observer_health`, `proof_coverage` fail;
`constitution_convergence` is `unknown`.

---

## 3. Active work

**In flight:**

| PR | Lane | What | State |
|---|---|---|---|
| #1678 | UTV2-1370, T1, **Codex** | Governed warehouse retention lifecycle, **including a migration** (`20260928131714_utv2_1370_warehouse_retention.sql`) | Codex-owned, `BLOCKED`. Its migration is production DDL — reserved. Do not touch its files. |
| — | WORK-2026092805, T3 | This plan edition, and the two docs that still described Track Only as "pinned" | this lane |

**Landed 2026-09-27 → 09-28:** #1667 (Codex, Command Center settlement truth), #1671 (staging CI
serialization), #1672 (`runtime:health`), #1675 (Track Only fix), #1676 / #1677 (its lane binding
and proof-profile repair). All closed except WORK-2026092606 (#1667), which is accepted closeout
debt — do not rewrite its manifest.

**Milestone 2, measured against `intent.md`'s six conditions (2026-09-28):**

| # | Condition | State |
|---|---|---|
| 1 | Repeatable submission without per-submission engineering | **The form repeats, and now honours the requested mode.** 11 governed picks; `92789b58` went in with no engineering intervention. Events still do not: `92789b58` has `eventId: null` because no Red Sox @ Yankees event exists; only operator-seeded events do. |
| 2 | Canonical identity and truthful provenance on every pick | **Holds for all 11.** `92789b58` resolved both participants `canonical`. |
| 3 | Grading and settlement on schedule against real results | **Settlement proven, automated grading deferred** (SGO). Picks with `eventId: null` skip grading at `event_link_not_found`. |
| 4 | Statistics computed from persisted history | **Reconciles, minus CLV**, and the effective-settlement readers are **now deployed**. |
| 5 | Operator observes through a governed internal surface | **Holds.** Command Center, signed in through the bridge, rendered `92789b58` correctly. It does **not** show the pick's delivery-authorization record, participant resolution, submission mode or edge-scope reason, and its list row omits capper, units and a Track Only badge — a product-contract gap, recorded not filed. |
| 6 | None of it achieved by activating member-facing delivery | **Holds.** All governed targets killed; both delivery-eligible queued picks wait `pending`. |

**The governed cohort predicate is `metadata ? 'distributionMode'`, and getting it wrong is
silent.** About 93% of `picks` are CI fixtures predating staging isolation.
`v_governed_pick_performance` filters `source = 'board-construction'`, so it cannot contain an
operator submission. Identify genuine submissions *positively*.

---

## 4. Blockers

| Blocker | Blocks | Owner |
|---|---|---|
| **Two delivery-eligible picks are queued behind a killed switch** — `2cc92f4b`, and `c12f1e2f`, which was only delivery-eligible because of the now-fixed defect | their delivery or retirement | Griff — §5 decisions 1a, 1c |
| **No current game is selectable as an event** without an operator seeding one | Milestone 2 condition 1, grading of new picks | operator: `scripts/ops/seed-operator-event.ts` with production credentials |
| **Results supply: no `game_results` after 2026-06-30** | condition 3 (automated grading), CLV, `grading_health` | **owner-deferred** (SGO), §5 decision 2 — not to be routed around |
| **A second data source cannot be admitted by an agent** | any non-SGO route to schedules or results | `PROVIDER_AUTHORITY_LOCK.md` is an active T1 rule; amending it is PM-owned |
| **The canonical reference bootstrap is unowned** — #1484 was closed, not merged | routine reference-data seeding beyond the operator CLI | nobody; a gap, not a resolution |
| **`P0 Protocol` is still blind to `WORK-###`** | tracker-independence exit condition 1 | reserved (merge authority) |
| **The warehouse is built but not provisioned**; #1678 adds retention with a migration | archiving off Supabase; any prune; `db_tripwires` | owner actions in `WAREHOUSE_OBJECT_STORAGE_PROVISIONING.md` — §5 decision 10 |

**No longer a blocker**, each verified 2026-09-28: the 109-commit deploy drift (deployed);
staging CI cross-run corruption (#1671 merged); the Track Only widening defect (fixed, deployed,
accepted in production).

---

## 5. Decisions required from Griff

| # | Decision | Reserved under | Blocks |
|---|---|---|---|
| 1a | **Whether to release delivery-eligible pick `2cc92f4b`**, `pending` on `official-picks` since 2026-09-23 02:21 behind `killed = true`. Left alone, it will never deliver. | member-delivery activation (2) | that pick's delivery |
| 1c | **Disposition of `c12f1e2f`** and its outbox row `5005f461`. It was submitted as Track Only and became delivery-eligible only through the fixed defect. Any change to it is a production data write. | production data (1) / member delivery (2) | that pick only |
| 1b | **Settle `ed0ed43c`** (delivered 2026-09-18, still `posted`) through the Command Center once its game is final | operator action, not reserved | condition 4 completeness |
| 2 | **SGO — OWNER-DEFERRED 2026-09-18.** Do not re-raise until provider-independent work is exhausted. `RESULTS_BACKFILL_AUTHORIZATION_PACKET.md` stays valid. | secrets (4) / paid provider (3) | automated grading, CLV, provider-fed supply — **deferred, not failed** |
| 7 | **#1491 / #1492 architecture review** | merge authority | those two PRs only |
| 8 | **#1451** — production DDL, `verify` red | production DDL (1) | #1451 only |
| 9 | **Direct-`main` prevention control** (`enforce_admins: false`) | branch protection | nothing; the prohibition is already in force |
| 10 | **Warehouse provisioning**, and now #1678's retention migration. Owner sequence: `WAREHOUSE_OBJECT_STORAGE_PROVISIONING.md` §6. | secrets (4), production DDL (1) | the conveyor's first real run; any relief for `db_tripwires` |
| 11 | **Smart Form intent §2 wording.** `docs/03_product/smart-form/intent.md` §2 still says "Track Only is pinned server-side and delivery cannot be enabled from this surface". The ratified behaviour now lets a server-authorized capper request delivery from the form. That sentence is product intent, so it is Griff's to restate. | product intent | nothing; a doc correction |

Decision 1 (deploy) and decision 5 (#1671) of the previous edition are resolved: `063a9f36a` is
deployed and #1671 merged. The other numbers are kept stable.

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

1. **Command Center pick-detail truth.** Render what the database already records for a governed
   pick: the `deliveryAuthorization` decision and reason, participant resolution, submission mode
   and edge-scope reason; add capper, units and a Track Only badge to the list row. Read
   `COMMAND_CENTER_PRODUCT_CONTRACT.md` first. Coordinate with Codex — Command Center has been its
   lane.
2. **Smart Form copy.** `BetSlipPanel.tsx` says "Requesting Track Only — the server decides
   delivery". The server now guarantees Track Only; the copy should say so. UI change; needs a
   deploy to take effect.
3. **UTV2-1953 stays queued** by PM instruction; UTV2-1952 follows it. Do not start either
   without a PM release.
4. **Seed a current event, then submit again** in an unexercised market shape (player prop, total,
   multi-leg), so condition 1 and grading are tested with a real event link. Needs an operator with
   production credentials.
5. **Repair `governance.awaiting-approval-drift`'s classification** (UTV2-1871). The repair belongs
   in the classification, never in the data.
6. **Re-home the inadmissible PRs** (#1429, #1491, #1492, #1495, #1498) through replacement PRs
   carrying the same diff. Renaming an open PR's head branch closes it for good. #1491 / #1492
   stay frozen pending PM review regardless.
7. **Correct the stale `LIVE_TARGETS` lists.** `scripts/pipeline-health.ts:311` and
   `apps/worker/src/replay-failed-delivery.ts:11` both hold `['discord:canary', 'discord:best-bets']`.
   Neither names `discord:official-picks`, the only target `human-capper` delivers to. Read both
   consumers before changing either; the worker file is runtime code.

**Not executable, and why:** delivery or retirement of `2cc92f4b` and `c12f1e2f` (decisions 1a, 1c);
automated grading and CLV (SGO, decision 2); #1678's migration (production DDL).

**On the governance slot.** A ceiling, not a quota. Record findings here and in
`plan-lessons.md` rather than filing them. One defect class gets one canonical issue.

**Findings recorded 2026-09-28, not filed** (each affects tooling, none blocks production):

- **A merged lane's proof cannot be repaired on its own lane.** WORK-2026092802's bundle authored
  `proof_profile: "runtime"`, which the shared evidence contract rejects, and nothing caught it
  before merge; closeout refused at P6/P9/R1/R2. The repair had to land under a second identity
  (WORK-2026092804) and close by `workflow_dispatch`. `proof_profile` must be `app-runtime`,
  `migration` or `static`; `app-runtime` also needs non-empty `runtime_proof.queries` and
  `row_counts`. Validate with `validateEvidenceBundleContract` before opening the PR.
- **WORK lanes still need `pr_url` bound in the lane PR itself**; otherwise closeout refuses and
  a separate repair lane is needed (WORK-2026092803).
- **The push-triggered closeout ignores WORK identities.** WORK lanes close only through
  `workflow_dispatch` of `post-merge-lane-close.yml` without the `pr` input.
- **`Return review packet` is red on every WORK-### PR.** It is not required.
- **The orchestrator cannot approve its own PR.** T2/T3 WORK lanes merge on the executor-result
  path of the Merge Gate.

**Lane hygiene owed.** 26 historical manifests sit at `merged`. Release a terminal lane's lease with
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
