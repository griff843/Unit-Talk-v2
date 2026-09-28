# Mission Plan — live

**Owner:** Claude. Rewritten as reality changes. Not a log, not a backlog, not Linear in Markdown.
**Last reconciled against live truth:** 2026-09-28 (evening), against `main` `a5399adc1` and deployed release `063a9f36a`
**Archives, read on demand — never at session start:**
[`plan-lessons.md`](plan-lessons.md) (operating lessons) ·
[`plan-history-2026-09.md`](plan-history-2026-09.md) (chronological narrative through 2026-09-14)

This file is startup context. It answers only what a session needs before it can act. It is rebuilt
from live GitHub, runtime and database evidence, not edited forward from its previous text. History
belongs in an archive above.

---

## 0. The direction, as corrected by Griff on 2026-09-28

**Move Unit Talk as close as possible to a sellable, operable product while SGO stays parked.**

- **Track Only production acceptance is complete** (§2).
- **Manual and eventless picks are valid** for contained operator testing. A pick with
  `eventId: null` and honest provenance is a correct pick, not a defect to repair.
- **Event-linked automated grading and CLV wait on SGO data supply.** That is a known data-supply
  dependency, not an execution target. It is parked until Griff authorizes SGO activation.
- **Manual event seeding is not the production strategy.** Nobody builds a substitute event feed
  and nobody manufactures production event coverage. `scripts/ops/seed-operator-event.ts` exists,
  but it is not a plan step.
- **Work everything that needs neither SGO nor Codex's occupied capacity**, in parallel where safe:
  the Smart Form language, the Command Center operator view, official-picks launch readiness and the
  paid-member path. §4 is the gap, §6 the wave.

---

## 1. Current truth

Measured 2026-09-28 against `origin/main`, the GitHub API and production `zfzdnfwdarxucxtaojxm`
(read-only SQL).

| Fact | Value |
|---|---|
| `main` | `a5399adc1` |
| Deployed release | **`063a9f36a`** — `Deploy` run `36426213004`, 2026-09-28 ~14:40Z, canary and production approved by Griff. The run's `syndicate_machine_mode.confirmed` line reads `human-capper`: ingestor autorun and scheduling off, worker on, one enabled target (`official-picks`), `killSwitchEngaged: true`. |
| Drift `deployed..main` | **No runtime code.** Only docs and lane files. Re-measure with `git diff --name-only 063a9f36a..origin/main`; never quote. |
| Governed pick cohort (`metadata ? 'distributionMode'`) | **11.** 7 `track-only` (all `validated`, including `92789b58`). 4 `delivery-eligible`: `816a84c7` settled, `ed0ed43c` posted, and **`2cc92f4b` and `c12f1e2f` voided** (below). |
| Retired sample picks | `2cc92f4b` and `c12f1e2f` were **voided by Griff's decision on 2026-09-28** (`queued → voided`, `operator_override`, one `pick.voided` audit row each). Their outbox rows `68f922a2` / `5005f461` were deliberately left `pending`; the worker skips a voided pick's row, so neither can post. **Do not touch them.** |
| Settlement records for the cohort | **6**, all operator-sourced; CLV null on all 6 |
| `discord:official-picks` outbox | 2 `sent` (816a84c7, ed0ed43c; 2 receipts, 2026-09-18) and the 2 voided picks' `pending` rows |
| Kill switches | `official-picks`, `best-bets`, `trader-insights`, `exclusive-insights` all `killed = true`. `official-picks` was last set 2026-09-19 02:24 by actor `claude:human-capper-e2e-window-close`. |
| Current-game events | 2 in the last 14 days, both operator-seeded historical test events. Not a supply; see §0. |
| Newest `game_results` | **2026-06-30** — SGO parked |
| Members | **`member_tiers` has 0 rows, ever.** No Whop, subscription, entitlement or webhook table exists. |
| `worker.heartbeat` / `grading.run` | alive and on schedule (grading honestly reports `degraded_stale_input`) |
| Cron | job 2 `awaiting-approval-drift-monitor` active; job 5 `nightly-retention-prune` **inactive — do not re-enable** without a PM-approved replacement retention design |
| Readiness ledger | **RED**, last generated 2026-09-28T13:23Z, **before** the deploy. Re-read after the next refresh before citing `deploy_sha_alignment`. |
| Open PRs | #1681 (mine, T2), #1680 (**Codex, active**, T1 migration-proof governance repair), #1678 (Codex, T1, warehouse retention with a migration), and the frozen or inadmissible #1556, #1505, #1498, #1495, #1492, #1491, #1451, #1429 |
| Lane manifests | 839 `done`, 28 `closed`, 27 `merged` (26 historical plus WORK-2026092606, accepted closeout debt), 1 `superseded`, and `started`: UTV2-1370 (Codex) and this session's lanes. Count with `jq .status docs/06_status/lanes/*.json`. |

**Milestone 1 is complete** (2026-09-09, pick `dfcd9486`). **Milestone 2 is active**; §3 gives its
conditions against §0's direction.

---

## 2. Production position

**`main` and production agree on runtime code.** The deploy of `063a9f36a` carried the 109-commit
backlog and the Track Only containment repair.

**Track Only production acceptance — complete, 2026-09-28.** Griff submitted pick `92789b58`
(Yankees ML −143, Track Only) through the deployed form as `griff843`.

- **Database:** submission and pick `track-only`; `deliveryAuthorization` `refused` /
  `track-only-requested`; status `validated`, one lifecycle event; **0 outbox rows, 0 receipts,
  0 execution intents**.
- **Command Center:** signed in through the governed bridge, it showed `Track Only — Verified: no outbox
  row, no receipt, no delivery attempt`. The pick was absent from every delivery, review, exception
  and settlement surface.
- **Containment:** unchanged throughout.
- **The fix it proves:** #1675, `TRACK_ONLY_INTENT_GUARD` in `handlers/submit-pick.ts`. A `track-only`
  request is never widened, and `delivery-eligible` needs the server allow-list or is refused.

**Readiness dimensions** (ledger 2026-09-28T13:23Z, pre-deploy — re-read):

| Dimension | Blocking | Status | Meaning |
|---|---|---|---|
| `deploy_sha_alignment` | yes | fail *(stale)* | Measured before the deploy; runtime drift is now zero. Expect a pass at the next refresh — re-measure, do not assume. |
| `ingestor_health` | yes | fail | **SGO parked** by design. |
| `grading_health` | yes | fail | **SGO parked**: no result after 2026-06-30. |
| `worker_outbox_health` | yes | pass | Counts only pending rows with `attempt_count > 0` — blind to never-claimed rows (§4.3). |
| `dead_letter_count` | yes | pass | Paged reader reads all rows. |
| `db_tripwires` | yes | fail | Real size findings; relief is the warehouse (§5 decision 10). |

---

## 3. Active work

| PR | Lane | What | State |
|---|---|---|---|
| #1681 | WORK-2026092807, T2, Claude | Smart Form receipt reads the server's `deliveryPosture`: a Track Only pick says Track Only, a refused delivery request carries its reason. The bet slip states Track Only stays Track Only and delivery is server-authorized or refused. | CI running |
| this PR | WORK-2026092808, T3, Claude | This plan edition and the Smart Form intent corrections | this lane |
| #1680 | WORK-2026092806, T1, **Codex (active)** | Migration-proof governance repair (`proof-schema.ts`, `truth-check-lib`, DB workflow docs) | **Do not touch its files or lane.** |
| #1678 | UTV2-1370, T1, **Codex** | Warehouse retention lifecycle **with a migration** | Holds `package.json` in its file-scope lock; production DDL is reserved |

**Milestone 2 against §0's direction:**

| # | Condition | State |
|---|---|---|
| 1 | Repeatable submission without per-submission engineering | **Holds for eventless picks.** 11 governed picks; `92789b58` needed no engineering. |
| 2 | Canonical identity and truthful provenance | **Holds for all 11.** |
| 3 | Grading and settlement on schedule against real results | **Settlement proven (operator). Event-linked automated grading is SGO-parked** — a data-supply dependency, not a target. |
| 4 | Statistics from persisted history | **Reconciles minus CLV (SGO-parked).** Effective-settlement readers are deployed. |
| 5 | Operator observes through a governed surface | **Holds, with display gaps** — §4.2; a Codex packet is ready. |
| 6 | None of it via member delivery | **Holds.** |

**The governed cohort predicate is `metadata ? 'distributionMode'`, and getting it wrong is
silent.** About 93% of `picks` are CI fixtures. `v_governed_pick_performance` filters
`source = 'board-construction'` and cannot contain an operator submission.

---

## 4. Pre-SGO launch gap

Sourced 2026-09-28 from three read-only audits of `main` `a5399adc1` plus production SELECTs. Each
item names its evidence; re-verify before building on it.

### 4.1 Production-proven

- Smart Form: reach, sign-in, canonical identity `griff843`, submit, persist, Track Only
  containment — performed by Griff (Milestone 1; `92789b58`).
- Operator settlement: 6 attested settlements; effective-settlement readers deployed.
- Command Center: deployed, reachable through the governed bridge (#1652), renders a governed pick
  and its verified non-delivery.
- `official-picks` delivery **once** (816a84c7, ed0ed43c, 2026-09-18, 2 receipts). Kill switch
  holds; `isKilled()` fails closed.
- Routing truth: a human-capper delivery is released in one transaction with its outbox row, or
  refused and no row is written (`submit-pick-controller.ts:176-253`).

### 4.2 Completable now, without SGO or Codex's occupied capacity

**Smart Form language** — #1681 (receipt, bet slip) and this PR (intent §2, §8). Done when both merge
and a deploy carries #1681.

**Command Center operator view** — a Codex T2 packet is ready (display only, no new reads). It covers:
- the delivery authorization decision and reason (`packages/contracts/src/smart-form.ts:93-126`, never
  rendered);
- the requested vs persisted mode;
- participant resolution (never read anywhere in `apps/command-center/src`);
- the edge fallback reason (`page.tsx:590-599`);
- an eventless-pick note (grading skips at `event_link_not_found`; settle manually);
- a voided banner;
- capper, units and a Track Only badge on the list row, which today shows `unrouted / SUPPRESSED`
  (`PicksExplorerClient.tsx:79-189`).

Follow-ups: a distribution-mode filter, and a kill-switch refusal reason on pending delivery-eligible
picks.

**`official-picks` launch readiness** — four gaps that should close **before any un-kill**:
1. **Delivery freshness is fooled by skipped rows.** `scripts/pipeline-health.ts:113-120,164` counts
   any `sent` row. After an un-kill the two voided picks' rows become `sent` with no receipt and would
   read as fresh deliveries. Derive it from `distribution_receipts` per target.
2. **`/health` fails open.** It reports healthy when its zombie check throws
   (`apps/api/src/routes/health.ts:272-278`), and never checks human-capper picks, because their
   `promotion_target` is null (`:101,149`).
3. **Replay excludes official-picks.**
   - The worker replay CLI accepts only `discord:canary` / `discord:best-bets`
     (`apps/worker/src/replay-failed-delivery.ts:11,186,307-310`), and `--target all` silently omits
     official-picks.
   - Neither replay nor `POST /api/picks/:id/retry-delivery` refuses when a sent receipt already
     exists.
4. **Double-post window.** The Discord POST sends no `nonce` / `enforce_nonce`
   (`apps/worker/src/delivery-adapters.ts:135-143`). A post that succeeds before a failed confirm or
   the 60 s watchdog is posted again.

Before an un-kill as well:
- `routes/kill-switch.ts:63` treats `reason` as optional.
- `DELIVERY_KILL_SWITCH.md` has no official-picks release checklist, pending-backlog review,
  double-post or dead-letter procedure.
- `worker_outbox_health` cannot see never-claimed rows (`readiness-refresh.ts:711-715`).
- The official-picks embed falls into the default branch with a "Unit Talk | Canary" footer
  (`delivery-adapters.ts:606-649`).

**Paid-member path, buildable now:**
- **The bot's tier sync is refused on every call and the error is swallowed.** The bot authenticates as
  `submitter`, the route needs `operator` (`apps/api/src/auth.ts:72,182-183`;
  `apps/discord-bot/.../api-client.ts:199-203`). Hence `member_tiers` has 0 rows.
- **Trials never expire.** No caller sets `effective_until` (`routes/member-tiers.ts:37-42`), and the
  expiry query re-audits already-ended trials every hour without removing the role
  (`runtime-repositories.ts:10619,10682-10688`).
- **Free members can read active picks.** `/live` and `/today` have no tier gate (`live.ts:29`,
  `today.ts:29`); the contract bars it (§3.3, §11).
- **Copy promises what is not live.** "Market context on every pick", "priority alert delivery",
  Best Bets / Trader Insights, line-movement signals, "CLV (vs SGO close)" and "Edge (sgo)":
  - `apps/…/site-config.ts:52,103,119,158,161`, `pricing/page.tsx:35`, `faq/page.tsx:53,63`,
    `trial-status.ts:81,83`, `upgrade.ts:157-168`, `heat-signal.ts:21,69`, `recap.ts:133`,
    `stats.ts:122-123`, `delivery-adapters.ts:545-548`;
  - the site also has no Trial tier and names the top tier "Syndicate", not the contract's Black Label.
- **No member onboarding or support path.** No join welcome, no purchase linking, no lost-access
  runbook.

### 4.3 Blocked specifically by SGO (parked — do not route around)

- Event-linked automated grading, and `grading_health`.
- CLV on every pick, closing lines, and `ingestor_health`.
- Market context and line movement: VIP+ intelligence, heat signals and live offers.
- Provider-fed schedules, and so event-bound participant search.

### 4.4 Blocked by open Codex T1 PRs

- **#1680:** migration-proof governance repair. Until it lands, avoid proof-schema, truth-check and
  DB-workflow docs.
- **#1678:** warehouse retention, and with it `db_tripwires` relief. Its migration is reserved DDL.
  Its `package.json` lock means no other lane can add a test file until it lands.
- **Whop entitlement intake** (next section) needs a migration. It queues behind Griff's DDL decision,
  not behind these PRs.

### 4.5 What still blocks taking a first paying member

In order. (a) buildable now, (b) needs Griff or an account/secret, (c) needs SGO.

1. **(b) Whop and Discord setup.** Whop product/plan IDs, the webhook secret, the bot's role
   position, VIP/Trial role IDs in the production env, and refund/cancellation policy. Prices and
   tier naming are Griff's (pricing authority).
2. **(a) Scoped bot credential for tier sync, and stop swallowing its error.** Proof: a Discord
   role change writes a `member_tiers` row; a refused call alerts.
3. **(a) Trial expiry that works.** Set `effective_until` on activation, use one definition of
   "active", expire each trial once and remove the role.
4. **(a)+(b) Whop webhook intake.** Signature-verified, idempotent, entitlement → tier, role
   removal on cancel/expire. Needs a migration (reserved DDL) and the webhook secret.
5. **(a) Tier-gate `/live` and `/today`.**
6. **(a) The `official-picks` gaps in §4.2**, then **(b) Griff's decision to un-kill
   `official-picks`** — member-delivery activation, reserved.
7. **(a) Copy pass.** Remove or mark unavailable every claim in §4.2; add the Trial tier and Free
   settled-results access.
8. **(a) Onboarding and support**, after item 4.

**(c) None of the above needs SGO.** A VIP/Trial product of human-capper picks with operator
settlement is sellable without it. Only VIP+ intelligence, CLV and automated grading wait on SGO.

---

## 5. Decisions required from Griff

| # | Decision | Reserved under | Blocks |
|---|---|---|---|
| 1b | **Settle `ed0ed43c`** (delivered 2026-09-18, still `posted`) through Command Center once final | operator action | condition 4 completeness |
| 2 | **SGO — parked by owner.** Automated grading, CLV and market intelligence wait on it. `RESULTS_BACKFILL_AUTHORIZATION_PACKET.md` stays valid. | secrets / paid provider | §4.3 only |
| 7 | **#1491 / #1492 architecture review** | merge authority | those PRs only |
| 8 | **#1451** — production DDL, `verify` red | production DDL | #1451 only |
| 9 | **Direct-`main` prevention** (`enforce_admins: false`) | branch protection | nothing; the prohibition holds |
| 10 | **Warehouse provisioning and #1678's migration** | secrets, production DDL | `db_tripwires` relief |
| 12 | **Whop and Discord setup** (§4.5 item 1): plan IDs, webhook secret, role IDs and position, refund/cancellation policy, prices and tier names | secrets, pricing and tier authority | the whole paid-member path |
| 13 | **Who may un-kill `official-picks`.** Today any `operator` credential can (`routes/kill-switch.ts`), and an agent session last toggled it. Making the release owner-only touches merge authority / reserved-decision mechanics; this is a proposal, not a change. | member delivery; merge authority | nothing now; must precede launch |
| 14 | **Un-kill `official-picks`** once §4.2's delivery gaps are closed | member-delivery activation | first paid delivery |

Resolved since the previous edition: the deploy, #1671, the disposition of the two sample picks
(voided), and the Smart Form intent wording (corrected in this PR under the direction above).

**Affirmatively not asked for.** No containment change, no SGO activation, no event seeding, no
clearing of the 32 stranded canary `processing` rows (§9), no re-enabling of cron job 5.

---

## 6. Recommended next production wave

**Under existing authority, nothing reserved, nothing SGO-dependent.** A reserved gate blocks only
the work that depends on it.

1. **Land #1681 and this PR.** The receipt change reaches cappers only through a deploy, and
   dispatching one is Griff's.
2. **Command Center operator view → Codex** (T2 packet ready, §4.2), when Codex's #1680 capacity
   frees up. Claude does not code it.
3. **`official-picks` launch hardening, Claude, in small lanes** (§4.2 items 1–4):
   - receipt-based delivery freshness;
   - `/health` failing closed;
   - replay target list plus a sent-receipt guard;
   - Discord `nonce`.

   Each is runtime code with its own proof; tier per the classifier floor. After them, an
   official-picks embed branch and the kill-switch `reason` requirement plus release runbook.
   New test files wait for #1678's `package.json` lock; extend existing tests meanwhile.
4. **Paid-member path, Claude** (§4.5 items 2, 3, 5, 7):
   - scoped bot credential and a visible sync failure;
   - trial expiry;
   - `/live` and `/today` tier gate;
   - the copy pass.

   None needs Griff to start. Whop intake (item 4) is designed and staged up to the migration, then
   surfaced as a reserved decision with the migration ready.
5. **UTV2-1953 stays queued** by PM instruction; UTV2-1952 follows it.
6. **`governance.awaiting-approval-drift` classification** (UTV2-1871) — repair the classification,
   never the data.

**Findings recorded, not filed** (tooling; none blocks production):

- **A merged lane's proof cannot be repaired on its own lane.** `proof_profile` must be
  `app-runtime`, `migration` or `static`, and `app-runtime` needs non-empty
  `runtime_proof.queries` and `row_counts`. Validate with `validateEvidenceBundleContract` before
  opening the PR.
- **WORK lanes need `pr_url` bound in the lane PR itself**, and close only through
  `workflow_dispatch` of `post-merge-lane-close.yml` without `pr`.
- **A delivery-ui lane may declare only its one app root** in `file_scope_lock`.

**Lane hygiene owed.** 26 historical manifests sit at `merged`. Release a terminal lane's lease with
`pnpm ops:lease release --issue <ID> --actor claude --reason "<why>"` at every closeout.

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
  the live switch, and `isKilled()` fails closed for a target with no row. The two retired
  sample picks' `pending` rows sat behind it for days without posting — that mechanism working.
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
