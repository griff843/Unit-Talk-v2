# Mission Plan — live

**Owner:** Claude. Rewritten as reality changes. Not a log, not a backlog, not Linear in Markdown.
**Last reconciled against live truth:** 2026-09-09

Answers five questions: what is true now, what is executable, what is blocked, what requires Griff,
and what was learned.

---

## Milestone 1 is complete — performed, then verified against production

**Griff performed Milestone 1 end to end on 2026-09-09 against the deployed system.** All seven
steps in `intent.md` hold, containment intact throughout. This is the first entry in this plan's
history that reports a milestone done rather than a blocker moved, and it is recorded from a
governed read-only production observation of the actual row — not from tests, not from a merge.

**Pick `dfcd9486-cba2-4bb5-b684-beec36e52c0b`**, submission `d70c0e43-3ab1-420f-95b1-6f27e2429756`,
created **2026-09-09T03:34:48Z** on deployed release `755e52a6c` (`Deploy` run `34296962788`,
2026-09-09T00:54:18Z). Measured against production `zfzdnfwdarxucxtaojxm`:

| Step | Evidence |
|---|---|
| 1. Reach the deployed form | The row exists with `source = smart-form`. |
| 2. Authenticate | `submitted_by = griff843` on the submission; the allow-list admitted a real sign-in. The `ALLOWED_CAPPER_EMAILS` shape gap below is **closed by this event** — the value was correct, and Griff's browser was its first and only test, exactly as predicted. |
| 3. Resolve canonical identity | `capper_id = griff843`, `metadata.capper` and `metadata.submittedBy` both `griff843`. No local-part derivation. |
| 4. Submit a real Track Only pick | MLB moneyline, selection `Dodgers`, `line = null` (correct — a moneyline has no line), odds **−110**, stake **3.00 units**, conviction 6 → confidence 0.60, book `fanatics`, event `Dodgers @ Brewers` dated 2026-09-09. |
| 5. Persist correctly | `status = validated`; one `pick_lifecycle` row, `from_state: null → validated`, `writer_role: submitter`, reason *"validated submission materialized into canonical pick"*. Participants resolve to **real** `participants` rows — `8a4dcd49…` Dodgers (away), `34f1a51c…` Brewers (home), both `participant_type = team`, `sport = MLB`. |
| 6. Track Only cannot create member delivery | **Zero** rows in `distribution_outbox`, `command_center_delivery_mappings`, `execution_intents` and `settlement_records` for this pick, and zero `distribution_outbox` rows repo-wide since 03:00Z. |
| 7. Observe through an internal/operator path | This observation. Read-only, governed, reading the one pick the pilot created and its delivery records, writing nothing and changing no containment setting — the form PM ratified on 2026-09-03. |

**Containment held.** The shipping deploy emitted
`{"service":"…","event":"syndicate_machine_mode.validated","mode":"parked"}`. Provider ingestion,
provider activation, system picks and member-facing delivery were all parked before the pilot and
all remain parked after it. Nothing was unparked to make the pilot complete, which is the condition
`intent.md` attaches to the milestone being considered done.

**The provenance is honest, which was the one thing that could have made a persisted row worthless.**
`metadata.participantResolution.resolution` reads `canonical` and the two team participant IDs
genuinely resolve; `eventId` reads `null` rather than a fabricated identifier. The record therefore
claims canonical resolution for exactly the part that was canonical and states the absence of the
rest. That is the structured/coverage-gap path `intent.md` permits for the contained pilot.

### Non-delivery is enforced, not merely absent

Zero outbox rows is the observation. The reason it is not a coincidence is that
`isTrackOnlyPickMetadata` — which returns true on exactly the `distributionMode: "track-only"`
string this row carries — gates seven independent paths on `main`: the submit-time pin
(`handlers/submit-pick.ts:95-104`), the enqueue chokepoint
(`distribution-service.ts:243` → `TrackOnlyDistributionError`), the atomic-RPC audit
(`run-audit-service.ts:70`), requeue (`controllers/requeue-controller.ts:25`), retry
(`controllers/retry-delivery-controller.ts:42`), recap exclusion (`recap-service.ts:203`) and
health (`routes/health.ts:104`). UTV2-1672 mutation-tested each one. As defence in depth,
`best-bets`, `trader-insights` and `exclusive-insights` are all `killed = true` in
`delivery_kill_switch`.

### The one finding worth carrying forward — a force-promote past the policy minimum

The pick carries `promotion_status = qualified` and `promotion_target = best-bets`, which reads
alarmingly on a Track Only pick and is **not** a containment failure. Promotion is business truth
and delivery is separately gated; `band` is `SUPPRESS` on all three policies. But the mechanism
underneath deserves recording:

`pick_promotion_history` shows `override_action: force_promote`, `override.forcePromote: true`,
reason *"smart-form submissions route directly to best-bets"* — promoting a score of **64.02**
against `best-bets-v2`'s own `minimumScore: 70`. The other two targets scored *higher* (72.28
exclusive-insights, 69.37 trader-insights) and were correctly suppressed on trust thresholds.

Under Track Only this reaches nothing. Under `delivery-eligible` it would enqueue a
below-threshold pick to a member channel on the strength of its *source* rather than its score.
That is a Milestone 2 question — Milestone 2 exists so that what is later shown to members is
earned — and it is recorded here rather than filed, per the ratified filing threshold.

---

## Reconciled current truth (2026-09-09)

Verified against `origin/main`, the GitHub API, git ancestry, live production SQL and the current
readiness ledger. Not against docs or chat history.

- `main` is `17741e6a4`. The tip is `ops(readiness): refresh ledger [skip ci]` — the bot commit that
  has been taxing every open lane's head-pinned artifact for six consecutive reconciliations.
- **Production is `755e52a6c` and is current.** This is the first reconciliation in this plan's
  history where that sentence is true:

  ```
  git rev-list --count 755e52a6c..origin/main                                    -> 1
  git diff --name-only 755e52a6c origin/main -- 'apps/**' 'packages/**' 'deploy/**' \
    | grep -v '\.test\.' | wc -l                                                 -> 0
  git diff --name-only 755e52a6c origin/main -- 'supabase/migrations/'  | wc -l  -> 0
  ```

  One commit, zero container-code files, zero migrations. The single commit is the readiness bot.
  **The 45-commit / 16-file gap the previous reconciliation called "the most consequential fact on
  this page" is closed**, and it closed the way that section said it had to: by a dispatch, not by
  more engineering.
- **11 PRs are open** (down from 13): #1429, #1451, #1479, #1484, #1491, #1492, #1495, #1496, #1498,
  #1505, #1513. Two left by merging — #1521 (UTV2-1843) and #1536 (UTV2-1856) — and #1539
  (UTV2-1859) merged after them, which is what removed the client-side player-prop refusal.
  - **Not admissible as a lane at all** (#1429, #1491, #1492, #1495, #1496, #1498) — six, unchanged
    for six reconciliations. All were opened with no `UTV2-###` in the branch, so `Merge Gate`
    cannot resolve a tier. Self-inflicted; the remedy is readmission, not a gate change.
  - **Admissible, awaiting a T1 verdict** (#1484, #1505, #1513) — three.
  - **Admissible, `verify` red** (#1451) — real repair work, production DDL, PM-gated.
  - **#1479** — `verify` green, needs an approval artifact rather than a repair.
- Branch protection on `main` requires exactly four checks: `verify`, `Executor Result Validation`,
  `Merge Gate`, `P0 Protocol`. `strict: true`. **`enforce_admins: false`**, no push restrictions,
  no rulesets, no required reviews. Unchanged.
- **No lane manifest is `in_progress` on `main`**, and `ops:brief` reports `claude_lanes=0`,
  `codex_cli_lanes=0`. The board is free.

### What the deploy changed about readiness, and what it did not

`deploy_sha_alignment` was the one blocking readiness dimension the previous reconciliation had to
concede was measuring something real — 45 commits, 16 container files. It is now measuring a
one-commit bot gap. The remaining blocking dimensions are unchanged in kind and still do **not**
mean the same thing as each other:

| Dimension | Status | What it actually means |
|---|---|---|
| `deploy_sha_alignment` | back to bookkeeping | 1 commit, **0** container files, 0 migrations. |
| `ingestor_health` | fail | **Containment.** `SYNDICATE_MACHINE_MODE=parked` sets `UNIT_TALK_INGESTOR_AUTORUN=false`. |
| `worker_outbox_health` | fail | **Containment.** Same mechanism — `UNIT_TALK_WORKER_AUTORUN=false`. Confirmed live: the last `worker.heartbeat` in `system_runs` is 2026-08-17. |
| `dead_letter_count` | fail | 1953 of 1954 rows are `bucket:governance_hold` with `attempt_count=0`, which `QUEUE_READINESS_SEMANTICS.md` v1.0 says do not fail readiness. The bucketing defect (`readiness-refresh.ts:517-532` buckets on `attempt_count`, not on reason) is unrepaired and recorded rather than filed. |
| `db_tripwires` | unknown | The observer itself is red, so tripwire state is **unproven** and correctly not scored as passing. |

**Readiness still cannot reach GREEN while containment holds**, because two blocking dimensions
measure precisely the flags containment sets to `false`. That was true before the deploy and is
true after it. What changed is that RED is now *entirely* a statement about the contained system
rather than partly a statement that production was stale.

### Grading is already running in production, and containment does not stop it

Measured in `system_runs`, not inferred from config — though the config explains it:
`deploy.yml:540` writes `UNIT_TALK_GRADING_CRON_AUTORUN=true` **unconditionally**, outside the
`SYNDICATE_MACHINE_MODE` case statement that gates the ingestor and worker autoruns. So grading is
deliberately not contained, and the evidence agrees: **13,720 succeeded `grading.run` rows**, latest
2026-09-09T02:49:27Z, with a matching `grading.cron.heartbeat` half a second later.

This materially changes the Milestone 2 starting position. Milestone 2 condition 3 is *"grading and
settlement run on their intended schedule against real results"*, and the plan has never before
established that the first half of that is already true in production. Two things it does **not**
establish, both of which Milestone 2 has to measure rather than assume:

- **The cadence is irregular.** Recent starts: 18:05, 19:41, 21:16, 22:47, 00:17, 02:49 — gaps of
  96, 95, 91, 90 and 152 minutes, against a `pollIntervalMs` default of 5 minutes. The loop is
  alive; "its intended schedule" is not yet a thing this plan can state, let alone assert is met.
- **370 `grading.run` rows are `failed`**, latest 2026-09-08T14:53Z. Unread.

### A permanently-red governance monitor — 12,634 consecutive failures

`governance.awaiting-approval-drift` runs every 15 minutes under `pg_cron` and has **failed 12,634
times**, latest 2026-09-09T03:30:00Z. The last two runs are byte-identical in their findings:

```
driftCount: 14984, staleCount: 14984, previousDriftCount: 14984,
countIncreased: false, staleThresholdHours: 4
```

The monitor computes `countIncreased: false` — it *knows* the backlog is static — and reports
`failed` anyway. The 14,984 stale `awaiting_approval` picks are consistent with the recorded ~93%
CI-fixture contamination of the production picks table, i.e. historical residue, not live drift.

**This is the "a control that fires on everything conveys no information" class, in its purest
form yet**: a monitor that has been red continuously for months cannot signal the genuine new drift
it exists to catch, and its own payload contains the field that would distinguish the two. The
repair belongs in the monitor's classification — alert on `countIncreased`, or on drift newer than
the fixture epoch — and explicitly **not** in the data, since production data deletion is reserved
decision 1. Recorded rather than filed pending the filing threshold; it has not yet stranded a lane,
but it is actively costing every operator who reads `system_runs`.

### Open incident — direct-`main` push, `717b46971`

On 2026-09-02T21:09:57-04:00 a Claude terminal ran `git push origin HEAD:main`, landing a 2-file

edit to `docs/06_status/lanes/UTV2-1826.json` and `UTV2-1828.json` with no PR.

`Direct Main Push Guard` fired and went red (run `33683588651`), classifying it
`unauthorized_direct_push`. It could not prevent it: the guard is detection-only by design, because
`enforce_admins: false` structurally exempts an admin credential from the required checks. No
`docs/06_status/INCIDENTS/` entry has been opened and the commit carries no
`Emergency-Bypass-Record` trailer.

`DIRECT_MAIN_BYPASS_POLICY.md` names this exact path twice — under Prohibited Bypasses ("editing
protected operational truth files on `main` to make a lane appear closed") and under Non-Emergency
Alternatives ("`git push origin main` is never the next step after this tool's output"). It cites
`INC-2026-07-14-utv2-1533-direct-main-push.md` Occurrence 3. **This is a recurrence of that
occurrence class**, not a novel event.

Prevention requires one of: `enforce_admins: true`; a ruleset restricting `main` pushes to the
Actions app with a named break-glass bypass; or a `pre-push` hook refusing `refs/heads/main` without
a referenced incident file. All three are PM decisions — merge authority and branch protection are
reserved surfaces.

**Sequencing.** The active direct-`main` prohibition is not deferred behind this backlog. The
prohibition is already in force and already binding on every agent; what is outstanding is a
*mechanical* prevention control, and that control is a reserved PM decision on branch protection —
not a lane, and explicitly not changed here.

It is worth stating plainly why, because an earlier draft of this plan got it backwards:
`enforce_admins: true` would also close the only route by which several currently-inadmissible PRs
could land. That is a real consequence, but it is an argument for correcting how those PRs were
created — they were opened outside the lane system and are inadmissible for that reason — not an
argument for leaving `main` mechanically unprotected until they clear. Incorrectly created PRs do
not earn a deferral of a safety control. The correct order is: PM decides the prevention control on
its own merits and on its own timeline; the inadmissible PRs are re-homed through normal governed
lanes regardless of that decision.

---

## Frozen pending PM architecture review

PM froze these on 2026-09-03. **Do not commit to them, do not resume them, do not design against
them.** Heads preserved:

| PR | HEAD | What |
|---|---|---|
| #1491 | `73fb6b76e` | Risk-Scoped Merge Authority (RMA/v1) — replaces manifest-tier merge authority with diff classification |
| #1492 | `77dea9c8d` | Mission-native harness recalibration — 53 files; relocates dispatch/lane commands, rewrites `CLAUDE.md`/`AGENTS.md`, hooks, settings |
| ~~#1497~~ | `6d8029d03` | Mission plan update, stacked on #1491 — **closed 2026-09-04**, superseded by the reconciliations in this file |
| #1495 | `429b0cff9` | verify-semaphore claim/release race (support work; head preserved) |

The ideas in #1491/#1492 are **not ratified merely because they are implemented**: replacing
Linear/lane execution authority, treating `docs/mission/*` as higher authority than canonical
contracts, removing lane manifests, demoting `/dispatch`, changing tiers to `auto`/`human`,
auto-merging core-contract changes, or materially changing Claude/Codex authority. The execution
and governance system on `main` remains controlling. See `intent.md` § "Changes to the operating
model".

---

## Milestone 2 — reliable internal operating history

Ratified 2026-09-05, begins now that Milestone 1 is complete, and completes **before** member-facing
Discord launch. Milestone 1 proved the path works once, under containment, for a single pick.
Milestone 2 makes it routine — enough real, internally submitted, correctly graded and settled picks
that whatever is later shown to members is *earned* rather than asserted.

The six conditions are in `intent.md`. Measured against them today:

| # | Condition | State on 2026-09-09 |
|---|---|---|
| 1 | Repeatable submission by intended operators, no per-submission engineering | **Plausible, unproven.** Exactly one pick has ever been submitted this way. One success is not repeatability, and the honest next step is a second and third submission rather than an argument. |
| 2 | Every pick persists with canonical identity and truthful provenance | **Holds for n=1.** The coverage-gap path recorded `eventId: null` honestly. What is untested is whether provenance stays truthful across market types — a player prop, a spread, a total. |
| 3 | Grading and settlement run on schedule against real results; outcomes traceable to score provenance | **Neither proven working nor proven broken — grading has never seen a real pick.** 13,722 succeeded runs prove a loop is alive, not that it grades. Every unsettled pick in its population is a fixture (below). The cadence is 90–152 min against a 5-minute poll, and the 370 failed runs are 100% infrastructure. |
| 4 | Statistics computed from persisted history and reconciling against rows | **Not started, and contaminated at the source.** ~93% of the `picks` table is CI fixtures and 14,984 picks are stale `awaiting_approval`. Any statistic computed over the raw table today is meaningless. |
| 5 | Operator observes all of it through a governed internal surface | **Partial.** Governed read-only SQL satisfied Milestone 1 step 7 and does not scale to an operating history. The Command Center (#1496) is the intended surface and is undeployed. |
| 6 | None of it achieved by activating member-facing delivery | **Holds and must keep holding.** Member-delivery activation is separately reserved and explicitly not part of Milestone 2. |

### The blocker underneath condition 4, stated before any statistics work starts

**A performance history cannot be computed from this table as it stands, and no amount of query
care fixes that.** Two independent contaminations:

- ~93% of `picks` are CI fixtures written before staging isolation landed (UTV2-1630).
- 14,984 picks sit in stale `awaiting_approval`, which is what keeps
  `governance.awaiting-approval-drift` permanently red.

Both are *historical* and neither can be deleted — production data deletion is reserved decision 1,
and deleting audit history to make a statistic look better would be exactly the kind of
self-serving cleanup this plan exists to prevent. **The answer is a governed cohort predicate, not
a delete**: statistics for Milestone 2 are computed over picks that are genuinely internal
operator submissions, identified positively rather than by excluding known-bad rows. The single
Milestone 1 pick is cohort member number one, and `v_governed_pick_performance` already exists as
a starting point that needs re-reading against this requirement before it is trusted.

Recorded here because getting this wrong is silent: a statistics surface that quietly averages CI
fixtures into a capper's ROI would look finished and be worthless, and it would be discovered by a
member rather than by a test.

### The condition-3 blocker, measured rather than inferred

This section previously said grading runs and "the rest is open". That understated one half and
overstated the other, and the correction matters because it changes what is worth building.

**Grading has never had a real pick to grade.** `runGradingPass`
(`apps/api/src/grading-service.ts:96-100`) reads exactly two lifecycle states, `posted` and
`awaiting_approval`. Measured in production on 2026-09-09, that population is 22,290 picks, none
created after **2026-07-30**, and every unsettled member of it is a fixture:

| market | unsettled `posted` picks with a line |
|---|---|
| `nba-spread` | 5,147 |
| `nfl-spread` | 2 |
| `player_points_ou` | 1 (`metadata.eventName = "db-smoke-…"`) |
| `points-all-game-ou` | 1 (`metadata.eventName = "db-smoke-…"`) |

5,149 of the 5,151 are **spread**, which `classifyMarketFamilyForGrading`
(`grading-service.ts:389-419`) classifies `unsupported` — they are skipped on market family, not
starved of results. The other two are DB smoke rows. So the settlement drought since 2026-07-30 is
**not** evidence that grading is broken, and the 13,722 succeeded runs are **not** evidence that it
works. Neither claim has ever been testable.

A second oddity from the same query, worth carrying: **1,179 picks hold a `settlement_records` row
while still sitting in `awaiting_approval`.** Grading skips them forever with
`settlement_already_exists`; nothing advanced them to `settled`. They are part of the 14,984 that
keep `governance.awaiting-approval-drift` red.

**Three layers stand between Milestone 1's pick and a settlement, and all three bind at once.**

1. **Lifecycle.** A Track Only submission persists at `validated`, which grading never reads. Only
   `posted` can reach `settled`, and `posted` means delivered. Ordinary engineering — this is
   UTV2-1861, and it is blocked only by #1479 holding `grading-service.ts` in its `file_scope_lock`.
2. **Market family.** Milestone 1's pick is an MLB moneyline. Moneyline and spread are both
   `unsupported`, and `:153` skips anything without a finite `line` — a moneyline always has
   `line = null`. Moneyline *results* exist (`points-all-game-ml`, 280 rows) but carry
   `participant_id = NULL`, so no side is attached and they cannot settle a moneyline as stored.
   Ordinary engineering, but a score-provenance design against `SCORE_PROVENANCE_STANDARD.md`.
3. **Results supply.** `game_results` and `events` both stop at **2026-06-30**. Nothing after that
   date can resolve an event at all.

### Layer 3 is answered, and the answer withdraws the unpark request

The previous version of this section named this the "first question Milestone 2 must answer" and
declined to request an unpark before measuring. That was right, and the measurement is now done.
It points away from an unpark twice over.

**First: an unpark is not an available action.** `SYNDICATE_MACHINE_MODE` is binary
(`deploy.yml:440-457`, duplicated at `:1033-1050`) — `active`, `parked`, or `exit 1`. There is no
setting that starts the ingestor alone. `active` simultaneously sets `_worker_autorun=true`, sets
`SYNDICATE_MACHINE_ENABLED=true`, and at `:474-477` releases `_enabled_targets` from the forced
`none` to whatever the `UNIT_TALK_ENABLED_TARGETS` secret holds — defaulting to `best-bets` when it
is empty. Worse, the readiness assertion that delivery is off (`:1475-1480`) runs **only in parked
mode**, its own comment noting that active mode's value "legitimately varies with the secret". The
one check that proves member delivery is off is the check that stops running the moment it would
matter. Since `intent.md` makes member-delivery activation separately reserved and explicitly not
part of Milestone 2, a request to unpark ingestion *is* a request to activate delivery.

**Second: it is not necessary.** Enumerated across non-test source, `events` has exactly one
physical writer — `DatabaseEventRepository.upsertByExternalId`
(`packages/db/src/runtime-repositories.ts:6176`), reached only from
`apps/ingestor/src/entity-resolver.ts:146` and `ingest-odds-api.ts:392` — and `game_results` has
one repository writer (`runtime-repositories.ts:4766`, from `results-resolver.ts:208,245`) plus
`scripts/seed-game-result.ts:187`, which POSTs directly with the service-role key. No API route,
server action, worker, migration or RPC writes either table. **But several operator CLI scripts
import the ingestor library and run it in-process** — `scripts/backfill-sgo-history.ts`,
`run-historical-backfill.ts`, `sgo-historical-coverage.ts`, `utv2-796-slate-replay.ts` — and none
of them consults `SYNDICATE_MACHINE_MODE` or `UNIT_TALK_INGESTOR_AUTORUN`.

So the daemon is not the only route to a results supply, and containment is therefore **not** the
binding constraint. The provider key is: the SGO key available to tooling returns
`403 Inactive API key`, verified live on 2026-09-09, and whether the production `SGO_API_KEY`
secret differs cannot be checked without reading a secret.

**What this plan therefore asks of Griff is smaller than an unpark, and is stated under "Requires
Griff" below**: confirm whether the production provider key is active, and — only if it is —
authorize a *bounded* operator-run results backfill under `DB_ENVIRONMENT_OPERATOR_POLICY.md`. Its
blast radius must be bounded before it is requested, because `ingestLeague` writes offers and
events broadly rather than results alone. **No containment change is requested, and the earlier
implication that one would be is withdrawn.**

### Executable now, under existing authority, nothing reserved

In dependency order. None of these needs Griff and none touches a reserved surface:

1. **Land UTV2-1861 — admit Track Only picks to the grading population.** Layer 1 above. Narrow
   by measurement rather than by hope: exactly **one** `validated` pick in production is Track Only,
   so admitting `validated AND isTrackOnlyPickMetadata` admits one row today, where admitting all
   `validated` would sweep 21,364. **Not blocked — see the correction below.** A drafted
   implementation is ready.
2. **Then layer 2 — make moneyline and spread gradeable.** Needs the score-provenance design for
   attaching a side to `points-all-game-ml`, not a classifier tweak.
3. **Submit again, twice, through the deployed form.** Condition 1 is a claim about repeatability
   and only repetition tests it. Different market shapes — a player prop (now that UTV2-1859
   removed the client-side refusal), a spread — because condition 2's provenance guarantee is
   untested outside moneyline. This is an operator action, not an agent one.
4. **Bound the results backfill before requesting it**, so the reserved item below arrives with its
   blast radius measured rather than described.
5. **Repair the grading pass's N+1.** Every pass loops all ~22,290 picks with a sequential
   `await repositories.settlements.findLatestForPick(pick.id)` (`grading-service.ts:105`). Each run
   records `started_at`→`finished_at` of ~240ms while consecutive runs are 88–152 minutes apart, so
   the time is spent inside the pass before the record opens. The 14,984 stale `awaiting_approval`
   picks are therefore not merely what keeps the drift monitor red — **they are the grading
   cadence.**
6. **Persist the skip histogram.** `grading-service.ts:368` records only
   `{picksGraded, failed}`, discarding the per-pick `outcome: 'skipped'` + `reason` it already
   computed. A pass that examined 15,000 picks and graded none is byte-identical to one that
   examined zero — which is precisely why the measurement above needed direct SQL.
7. **Repair `governance.awaiting-approval-drift`'s classification** so a real drift becomes visible
   again. Its own payload already carries `countIncreased: false`. The monitor is a SQL function,
   so landing the migration is ordinary work and *applying* it is production DDL — reserved
   decision 1. Note the interaction: any fix routing Track Only picks into `awaiting_approval`
   makes this monitor worse until its classification is repaired first.

**Three items from the previous list are done, and their answers are above:** the 370 failed
`grading.run` rows (100% infrastructure — `TypeError: fetch failed` ×134, statement timeout ×33,
an `undefined` error-serialisation defect ×58, upstream timeout ×3; none is a grading-logic
failure); the grading cadence (median gap **91.0 min**, min 88.1, max 152.5 over 109 runs in seven
days, against a 5-minute `pollIntervalMs` default with no production override); and the governed
cohort predicate.

**The cohort predicate, since getting it wrong is silent.** The positive marker is
`metadata ? 'distributionMode'` — **exactly 1 row**, Milestone 1's pick. Two traps sit next to it.
`v_governed_pick_performance` is `WHERE p.source = 'board-construction'` with INNER JOINs to
`pick_candidates`/`syndicate_board`/`market_universe`, so it **structurally cannot** contain an
operator submission and is not the starting point this plan previously assumed. And the natural
alternative, `capper_id = 'griff843' AND source = 'smart-form'`, returns **13** rows — 12 of them
proof fixtures from 2026-05-29 (`UTV2 Proof Player <hex> Over 27.5`), none carrying `testRun` or
any test flag, and **6 of them `settled`**. That predicate yields a plausible-looking six-pick
settled record made entirely of fixtures, which is exactly the failure mode this section exists to
prevent.

**Correction, made before this reconciliation merged: item 1 is not blocked, and an earlier draft
of this section said it was.** The draft asserted that #1479's `file_scope_lock` holds
`apps/api/src/grading-service.ts`, so preflight `PL6` would refuse a UTV2-1861 lane until that PR
merged. Measured rather than assumed, all three legs of that are false:

- **`docs/06_status/lanes/UTV2-1815.json` does not exist on `main`.** It lives only on #1479's
  branch, and its status there is `in_review`. `PL6` reads the manifests in the checkout, and **no
  manifest on `main` is `in_progress`, `blocked` or `started`** — so it sees nothing to overlap.
- **The lease is not held either.** All four `.ops/leases/` entries that were `active` on
  2026-09-09 belonged to lanes already `done` on `main`, and all four have been released.
- **The diffs do not even touch the same code.** #1479's `grading-service.ts` hunks are at `:2`,
  `:601-638` and `:973-1010` — the settlement-recap and `readSubmittedBy` region. UTV2-1861 changes
  `runGradingPass`'s population at `:96-100`. Zero overlapping lines; git merges both cleanly.

What remains is an ordinary sequencing preference, not a block: a second lane on the same file
means whichever PR lands second resyncs, and #1479 is head-pinned to an `EXECUTOR_RESULT` and a
staging DB receipt, so it is cheaper for it to land first. That is a reason to prefer an order, not
a reason to leave the milestone's only executable step unstarted.

**The generalisable error is worth naming, because this plan has now made it twice in two days.**
A `file_scope_lock` is a property of an *active manifest in the checkout*, not of a PR. Reading a
PR's declared scope and concluding that it locks a file conflates the artifact with the enforcement
that reads it — the same shape as the 2026-09-08 correction, where a tier floor was treated as a
given rather than as something computed from a file list. **The check is `PL6` against the
manifests on `main`, and it costs one command to run.**

So item 1 advances the milestone and is available now.


## Concurrent session ownership — Claude and Codex, 2026-09-07

Griff directed on 2026-09-07 that **Codex owns tracker independence in a separate session** while
this session continues the **Smart Form repair**. Two independent sessions on one repository is
exactly the condition that produced the 2026-09-03 drift incident, so the split is written down
here rather than held in either session's context, and it is enforced by the mechanisms that
already exist rather than by good intentions.

**The enforcement is mechanical, not conventional.** `file_scope_lock` is pinned at lane-start and
cannot be widened by an agent; preflight `PL6` refuses a lane whose candidate files overlap any
active manifest; and `.ops/leases/` refuses a second lane on the same files. A session that
declares its scope honestly at lane-start cannot silently take the other's files. Nothing below
replaces those checks — it tells each session what to declare so the checks never have to fire.

| Owner | Files | Why |
|---|---|---|
| **Claude (this session)** | `scripts/ops/preflight.ts`, `scripts/ops/shared.ts`, `scripts/ops/lane-start.ts` | the ratified PT1 route B admission change — see below. **Revised 2026-09-07**: an earlier draft of this table gave `preflight.ts` and `shared.ts` to Codex, before the ratification landed. |
| **Claude (this session)** | `apps/smart-form/**`, `apps/api/src/submission-service.ts` | Wave 1 steps 2–3 and UTV2-1842 |
| **Codex** | `scripts/ops/truth-check-lib.ts`, `scripts/ops/lane-close.ts`, `scripts/ops/lane-finalize.ts`, `scripts/ops/execution-packet.ts`, `scripts/ops/lane-maximizer.ts`, `.github/workflows/**` | items 3, 5, 6, 7 of the change set above, and the reserved items 8–11 if PM ever releases them |
| **Neither, without asking first** | root `package.json`, `.lane/lanes/governance.yml`, `docs/mission/plan.md` | genuinely shared; see below |

**`preflight.ts` moved sides, and Codex must be told before it starts.** Griff ratified PT1 route B
on 2026-09-07, which makes `preflight.ts` the file the highest-priority work edits. Codex's item 1
— *"emit PL1-PL5 as `skip` when there is no tracker ref"* — is in the same file. Those two changes
are independent in intent and adjacent in code, which is exactly the shape that produces a silent
conflict. This session takes the file for the admission change because it is now the priority item;
Codex's PL1-PL5 change should either wait for it to land or be authored against the merged result,
not in parallel.

**Root `package.json` is the one real collision, and this session has given it up.** The plan
already records that a lane which adds a `*.test.ts` must declare `package.json`, because `pnpm
verify` fails closed with `WIRING_TEST_UNWIRED_NEW` on an unreachable test file and the only wiring
point is the `test:ops` script. Codex's work is likely to add test files and will need it. This
session therefore wires the Smart Form e2e suite through **`apps/smart-form/package.json`'s own
`verify` script**, which `verify:static` already invokes as `pnpm --filter @unit-talk/smart-form
verify` — no root edit, no overlap, and one less thing to serialize. UTV2-1850's declared scope is
`apps/smart-form/**` alone for this reason.

**Merges are serialized, and `strict: true` is what does it.** Branch protection requires a branch
to be current with `main` before merging, so two ready PRs cannot land simultaneously — the second
resyncs. The rule each session follows is: check for an open PR from the other session in a
mergeable state before merging, and land the one that is already green rather than racing it. The
sanctioned resync is `pnpm ops:merge-wrapper main-sync`; a direct `git push origin main` is
prohibited regardless of how convenient the ordering makes it look.

**`docs/mission/plan.md` is shared.** UTV2-1849 (#1527) landed on 2026-09-07 and UTV2-1858 is
editing it now. Codex should reconcile its own findings into this file after UTV2-1858 lands, not
concurrently.

---

## The route B bootstrap — why the admission change takes two lanes

**SUPERSEDED 2026-09-08 — retained as a record of the reasoning, not as a plan.** The admission
landed in **one** lane (UTV2-1851, #1528), not two. The hazard this section identifies is real and
was closed exactly as described — a deferral-carrying manifest cannot be created without the
obligation recorded on it — but the ordering constraint below was derived from the assumption that
the manifest carry-forward had to live in `lane-start.ts` (T1-floored). It went into
`createManifest` in `shared.ts` (T3) instead, and the sequencing problem dissolved. See Learned.

Ratified 2026-09-07. The remaining admission diff is the three edits in
`PT1_CONTAINMENT_ADMISSION_DECISION.md` §6a. They do **not** all sit at the same tier, and that is
the whole scheduling problem:

```
['scripts/ops/preflight.ts']   -> T3   (no matches)
['scripts/ops/shared.ts']      -> T3   (no matches)
['scripts/ops/lane-start.ts']  -> T1   (rule_id: tier-c-pattern)
```

`lane-start.ts` matches `/^scripts\/ops\/(?:lane|merge|tier)-[^/]+(?<!\.test)\.ts$/`. So the
edit that copies the deferral onto the manifest is **T1-floored, and therefore blocked by the exact
refusal this change exists to lift**. The change cannot land in one lane from a contained
workstation. It is not a deadlock — it is an ordering constraint, and it resolves in two lanes:

| Lane | Tier | Files | What it does |
|---|---|---|---|
| 1 | **T3** — opens today | `scripts/ops/preflight.ts`, `scripts/ops/shared.ts` | stops folding `blocked_by_containment` into `INFRA`, writes `t1_live_db_precondition: "deferred_to_ci"` into the generated token, and **refuses to admit a manifest that drops it** |
| 2 | **T1** — opens only after lane 1 merges | `scripts/ops/lane-start.ts` | copies the deferral from the validated token onto the manifest |

**The order is the dangerous part, and lane 1 has to close it rather than leave it open.** Between
lane 1 and lane 2 there is a window in which PT1 no longer refuses, so a T1 lane can be opened while
`lane-start` still knows nothing about the field — the manifest would carry no
`t1_live_db_precondition`, `G6` would evaluate `skip`, and the live-DB obligation would be
**silently discarded**. That is precisely the failure the ratification names.

Lane 1 therefore carries the bridge, and it is placed where it can be: `validateManifest` in
`shared.ts` already validates the manifest's `preflight_token` **path**
(`shared.ts:1748-1759`, via `validatePreflightTokenPathValue`). Lane 1 extends it to read the
token's **contents** and fail closed when the token records a deferral the manifest does not. So
between the two lanes a deferral-carrying lane cannot be created at all — the manifest is rejected —
and nothing is admitted that G6 would later fail to see. The obligation cannot be dropped by
omission, only by a change that deliberately removes the check, which is what mutation testing is
for.

Malformed is handled by the rules UTV2-1848 already landed: an unrecognised
`t1_live_db_precondition` value is a `validateManifest` **error**, never ignored, and the field is
an error at any tier other than T1. Lane 1 adds the third case — present in the token, absent from
the manifest — so all three of missing, malformed and mismatched fail closed.

**The two contract specs are T1-floored too, which decides where they land.** Measured:
`docs/05_operations/TRUTH_CHECK_SPEC.md` and `docs/05_operations/LANE_MANIFEST_SPEC.md` both match
`tier-c-pattern`, so adding either to lane 1's scope would floor lane 1 at T1 and make it
unopenable — the same refusal, reached by a different file. They go in lane 2, which is T1 anyway
and which is the point at which the contract is actually complete rather than half-written. Lane 1
carries `docs/05_operations/schemas/preflight_token_v1.schema.json` (T3) so the new token field is
documented where it is emitted rather than left implicit; the schema needs no strictness change,
since it already sets `additionalProperties: true`.

**What lane 1 must not do.** It must not weaken any other preflight check to get itself admitted,
and it must not write a token by hand. Its own lane is T3, so it opens through the ordinary
credential-free path with every check actually run — `PB1` type-check and `PB2` full `pnpm test`
included. Hand-generating a substitute passing token is prohibited by the ratification and is not
needed by this sequence.

**Staging verification is preserved, not replaced.** Route B defers the *precondition*, not the
proof: a T1 lane admitted this way still owes `verify` and `Writable DB proof (staging only)` green
on its merge SHA, and `G6` refuses closeout without both. The deferral moves where the live-DB
evidence is obtained — from the operator's workstation to CI — and changes nothing about whether it
is obtained.

---

## Execution waves

Production-first. The waves are a dependency ordering, not a queue: work in a later wave that
does not depend on a reserved item proceeds immediately and in parallel.

**A reserved gate blocks only the action it reserves.** It does not block the mission, and it does
not block unrelated safe production work. Nothing in this plan should be read as "everything is
waiting on Griff" — at any moment most of the board is independent of every open reserved item.

### Wave 0 — reserved actions (Griff only)

**For the first time in this plan's history, no row in this table blocks the active milestone.**
Row 1 has been the Milestone 1 blocker in every previous version — a `Deploy` dispatch on
2026-09-06, the PT1 admission, then a second `Deploy` dispatch. That second dispatch happened on
2026-09-09T00:54Z, Milestone 1 was performed against the release it shipped, and the row is gone.

Every remaining row blocks only itself. **Milestone 2's executable work needs none of them**, and
Milestone 2 has not yet produced a reserved item of its own — see the containment-interaction
section above, which deliberately declines to request an unpark before measuring whether one is
needed.

| # | Action | Why reserved | What it actually blocks |
|---|---|---|---|
| 1 | Approve **#1513** (UTV2-1802, T1) — Command Center management token can no longer be handed arbitrary SQL | Merge authority | #1513 only. Pre-deployment hardening; the Command Center is in no compose service and behind no Caddy route. |
| 2 | Approve **#1484** (`pm-verdict/v1`) — canonical reference bootstrap | Merge authority | #1484 only. Not a Milestone 1 gate. |
| 3 | Review **#1491 / #1492** as an architecture decision — not as engineering to resume | Merge authority | Those two PRs only. Explicitly not the mission. |
| 4 | Decide the direct-`main` prevention control (`enforce_admins`, a ruleset, or a `pre-push` hook) | Branch protection | Nothing. The prohibition is already in force; what is reserved is the mechanical enforcement. |
| 5 | Any production containment change (`parked` → `active`) | Containment | Nothing today. Milestone 1 completed with containment intact; Milestone 2 has not yet established that it needs any unpark. |

**Eight items have left this table by being done rather than by being deferred.** The two newest
are the ones that emptied the Milestone 1 critical path:

- **The second `Deploy` dispatch — completed 2026-09-09T00:54:18Z, run `34296962788`, shipping
  `755e52a6c`.** It carried the whole Smart Form submission repair into production, and Milestone 1
  was performed against it hours later. The packet that prepared it was right about the change and,
  unlike its 2026-09-06 predecessor, was not blindsided by the mechanism: the deploy succeeded on
  the first attempt.
- **Approve #1536 (UTV2-1856)** — merged, as did #1539 (UTV2-1859), which removed the client-side
  player-prop refusal that #1536 had left stranded. The pairing is the recorded duplicated-rule
  lesson closing itself out.

- **The PT1 containment admission — ratified 2026-09-07, landed as UTV2-1851 (#1528).** It had been
  row 1 and was the widest-reaching item on the table: it blocked not only UTV2-1842 but *every*
  lane the mechanical floor raised to T1. A T1 lane can now be opened from a contained workstation,
  with the live-DB obligation recorded in the token, carried onto the manifest, and enforced at
  closeout by `G6`. Nothing was loosened to achieve it.
- **The first `Deploy` dispatch — completed 2026-09-06T15:12:30Z, run `34041575531`, shipping
  `d3f69b804`.** Row 1 for five days. Done, and the Milestone 1 path did not open, which is what
  surfaced UTV2-1842 underneath it.
- **The `scope-override/v1` on #1521** — closed without needing Griff at all. UTV2-1857 (#1537)
  landed the `.lane/lanes/governance.yml` registration byte-identically as its own lane, so the
  resync dropped that file from #1521's diff and `File scope lock` is green. Recorded because the
  general move is reusable: when a lane's only scope violation is a shared registry file, landing
  that registration in its own lane is cheaper than a head-pinned human artifact.
- The former item 1 before those — reshape `ALLOWED_CAPPER_EMAILS` — completed by Griff on
  2026-09-03T17:29Z.
- Decide #1477 — resolved by correcting the proof bundle rather than the implementation; merged at
  `1734bf20` on 2026-09-05T01:43Z.
- Approve #1501 (UTV2-1823) — merged at `b7d9fc07` on 2026-09-03T19:26Z. The anonymous
  `GET /api/picks/{id}/trace` exposure that would leak the pilot's own pick is closed in code, and
  **still not in production** — it is one of the 45 commits row 1 would ship.

Command Center secrets are **not** in this table. They are not a Milestone 1 prerequisite; see
`intent.md` § "Step 7 — observation path".

### The *first* deployment decision packet (2026-09-06) — closed, kept for what it got right and wrong

This packet prepared the 2026-09-06 dispatch. **That decision was taken and that action completed**,
so it is retained here only as a record — the packet for the *next* dispatch is above under "The
deploy decision packet", and trimmed to the parts that are still load-
bearing. It is no longer something Griff has to read before acting.

**What the packet got right.** It insisted on measuring the release rather than describing it, and
the measurement held: the release really did contain exactly two container-code changes (#1488
canonical identity, #1501 authenticated trace), the Command Center really was in no compose service
and behind no Caddy route, and there really was no DDL prerequisite — `deploy.yml` runs no migration
step, and `rate_limit_buckets` plus `consume_rate_limit_bucket(...)` already existed in production.
All three still check out.

**What it did not anticipate.** It framed the risk entirely as *a bad `ALLOWED_CAPPER_EMAILS` value
shipping green*. The deploy that actually failed failed for a different reason — a defect in the
deploy workflow's own `verify` job — and no part of this packet was watching for that. The
generalisable point is that a decision packet which enumerates the risks of *the change* can still
miss the risks of *the mechanism that applies the change*.

#### The allow-list gap is still open, and is now the live Milestone 1 risk

Nothing in the deploy validates the **shape** of `ALLOWED_CAPPER_EMAILS`; it is checked non-empty at
three layers and shape-validated at none (`deploy.yml:100`, `:486`/`:974`, and
`deploy/production/nextjs-entrypoint.sh:28-31`). `scripts/deploy-check.ts` does not reference it.
The parser (`apps/smart-form/lib/auth-allowlist.ts:43-66`) **silently drops** any entry lacking `=`
or failing `^[a-z0-9][a-z0-9_-]*$`, with no fallback and no log, so an all-malformed value yields an
empty allow-list and `signIn` returns `false` for everyone.

The `smart-form` healthcheck is `curl -fsS localhost:4400/login`
(`deploy/production/docker-compose.yml:223`), which returns 200 regardless of allow-list contents,
and the `smoke` job only asserts `localhost:4000/health == 200`. **So the deploy reported healthy
without ever exercising the allow-list.** Whether the value is right is still unknown, and
Milestone 1 step 2 — Griff's own browser — remains its first real test. That is now an *immediate*
question rather than a prospective one, because the code that reads it is live.

The one-command local check remains the cheapest way to answer it before spending a browser attempt:

```
ALLOWED_CAPPER_EMAILS='<value>' pnpm exec tsx -e "import {parseAllowedCapperEmails} from './apps/smart-form/lib/auth-allowlist.ts'; const r=parseAllowedCapperEmails(process.env.ALLOWED_CAPPER_EMAILS); console.log('entries:', r.length, 'ids:', r.map(x=>x.capperId).join(','))"
```

Non-secret success criterion: prints `entries: N` with `N >= 1` and `ids:` containing `griff843`. No
email address is printed and no value leaves the machine.

#### Rollback, if it is ever needed

`deploy/rollback.sh:71-79` restores `.env.production`, `.env.web` and `.env.smart-form` from the
per-tag configuration snapshot and warns explicitly when no snapshot exists, so a rollback after a
bad allow-list restores the old-shaped value alongside the old parser (UTV2-1834, #1507). UTV2-1835
(#1511, `ce3b87bf8`) closed the remaining gap where a failed retry could capture the failed
attempt's configuration over the running release's, via a `.unit-talk-deploy-inflight` marker —
which matters precisely because the documented recovery from a bad allow-list *is* a same-tag
redeploy.

There is still **no automatic rollback**: `ROLLBACK_TAG` is an optional, empty-by-default dispatch
input (`deploy.yml:10-13`), and a failed health loop just fails the job with production on the new
tag. Rollback images resolve at the full 40-char tag for every service.

### Wave 1 — Smart Form Track Only pilot (Milestone 1) — **COMPLETE 2026-09-09**

**Every step in this wave is done, and the pilot itself has been performed.** The wave is retained
as the record of how it closed, because the sequence is reusable and because two of its entries
were wrong in instructive ways. The evidence for the pilot is at the top of this file under
"Milestone 1 is complete"; the board has moved to Milestone 2.

Step 4 (the deploy) completed 2026-09-09T00:54Z. Step 5 (the pilot) was performed by Griff hours
later and verified by governed read-only production observation. What follows is the 2026-09-08
text, kept for the record.

1. ~~**Decide UTV2-1842's admission.**~~ **Done** — ratified 2026-09-07 (route B), landed as
   UTV2-1851 (#1528). See "The PT1 containment admission is closed" above.
2. ~~**Land UTV2-1842's server half.**~~ **Done** — #1529 (`40b0f19f4`) admits server-validated
   Smart Form fallbacks past the event-existence gate. UTV2-1853 (#1531) added the server-side
   numeric bounds, UTV2-1855 (#1533) clamped the units stepper to the schema bound and deleted the
   dead odds validator, and UTV2-1854 (#1535) made team and player search answer from
   `participants` rather than from an unpopulated canonical catalog.
3. ~~**Verify the combined flow before release.**~~ **Done, and honestly bounded.** UTV2-1850
   (#1530, `89cca15da`) asserts the persisted pick in the Smart Form e2e suite **and wires it**:
   `apps/smart-form/package.json`'s `verify` script now ends in `node scripts/run-e2e-gate.mjs`, and
   `verify:static` already invokes `pnpm --filter @unit-talk/smart-form verify`, so the execution
   site is inside the required `verify` check with no workflow edit.

   **The gate is wired and defaults to off, and that was a deliberate, recorded choice rather than
   an oversight.** `run-e2e-gate.mjs` runs the suite only when `UNIT_TALK_SMART_FORM_E2E` is exactly
   `'1'`; unset, empty, `'0'`, `'true'` and `'yes'` all leave it off. The reason is the one Griff
   stated on 2026-09-07 — *"any change to the required CI execution path should be reviewed as part
   of the actual change, regardless of file-based tier minimum"* — because turning it on also
   requires `playwright install chromium --with-deps` inside a required check, which changes what
   that check does and how long it takes. `ci.yml` never mentions Playwright today.

   **The fail-closed direction is the right way round**: the default is a *coverage* decision, never
   a correctness one. When the flag is set, a failing suite fails `verify`; the gate cannot report
   success for a suite that failed.

   **Enabling it is now executable and is not reserved.** It is a one-line change to `ci.yml` — a
   Tier C prefix, so T1-floored — and the PT1 admission that used to make such a lane unopenable
   from a contained workstation has landed. It should be reviewed on its own terms as a change to
   required-check behaviour, which is exactly what its T1 floor delivers.

   **The persistence half stays where the credential already lives.** The Playwright config keeps
   its empty `SUPABASE_*` and stays a browser → API contract harness; `run-e2e-gate.mjs` strips any
   `SUPABASE|DATABASE_URL|SERVICE_ROLE` key from the child environment, and its test asserts every
   branch of that denylist. Persistence is asserted by `pnpm test:db` / the
   `Writable DB proof (staging only)` job, which `assert-staging-target.ts` pins to
   `xskgrzbteyqdufktjrjx`. That separation is why the staging database's ~93% CI-fixture
   contamination is not repeated.

4. ~~**Dispatch the deploy.**~~ **Done** — 2026-09-09T00:54:18Z, run `34296962788`, shipping
   `755e52a6c`. Succeeded on the first attempt; the deploy-workflow defect that failed the
   2026-09-06 attempt had been repaired by UTV2-1841.
5. ~~**Then run the pilot itself.**~~ **Done, and performed by Griff rather than simulated** —
   2026-09-09T03:34:48Z. Reached the form, authenticated, resolved `griff843`, submitted a real
   internal Track Only pick, persisted it, and the Track Only guards held. Containment stayed
   parked throughout. Evidence at the top of this file.

**This wave is closed.** Its last two steps were the only ones that had never been attempted end to
end, and both were performed on the same night.

#1477 is **not** a Milestone 1 dependency; it is unrelated rate-limit DDL and is sequenced on its
own merits.

### Wave 2 — CLV / data truth

| PR / work | State |
|---|---|
| #1479 null-stake computation truth | **`verify` is green.** Only `Merge Gate` fails, so what it needs is an approval artifact, not a repair, and three of its non-required reds are each closed only by a Griff action (a `scope-override/v1` or `skip-proof-coverage` for the cross-PR proof-coverage rule; a commit-message rewrite that would move the anchor its staging receipt is bound to; and a read-only production credential, reserved decision 4). This plan states no verdict on it. |
| #1451 June offer-history partitions | `verify` red; production DDL; PM-gated |
| #1484 canonical reference bootstrap | `verify` green; needs a verdict (Wave 0 row 4) |
| **The one `true_failure` dead-letter row** | **Read 2026-09-06 — done, and it was not a delivery failure.** It is the `proof-pick-blocked` guard refusing a `t1-proof` fixture to `discord:canary`, with its own run recorded `succeeded`. See the readiness section above. What remains is the *bucketing* defect it exposed in `readiness-refresh.ts:517-532`, recorded rather than filed. |
| Closing-line truth | Not yet a branch |

### Wave 3 — Command Center

**Half of this wave is done.** #1493's diff landed as **#1503 (UTV2-1812, `9ac4694d9`)** — the
dotted-path authentication bypass is closed on `main`. #1494's is open as **#1513 (UTV2-1802)**,
green on `verify`, and needs only a T1 verdict; it is Wave 0 row 3.

Both are **pre-deployment hardening, not live exposure**: the Command Center is in no production
compose service and behind no Caddy route, so they harden a surface #1496 would create rather than
close a reachable one. They must land before #1496 for exactly that reason.

#1496 (deployment) still needs Command Center secrets and a hostname and remains inadmissible as a
lane — it carries no `UTV2-###` in its branch, so `Merge Gate` cannot resolve a tier. Readmission
runs through `ops:lane-start --readmit-existing-branch --executor <who>` under a canonical issue.

Deployment is tracked here on its own product merits. It is **not** a Milestone 1 gate, and no
`COMMAND_CENTER_*` secret is a Milestone 1 prerequisite.

### Wave 4 — models / research

Nothing identified as safely independent of the waves above. Requires a scope check before starting.

### Wave 5 — website / product optimization

Not started.

### Wave 6 — exactly one governance lane at a time

**The slot is empty, and it emptied by being spent well.** Since the previous reconciliation four
lanes have passed through it, each closing a defect that had already cost real lanes:

- **UTV2-1851 (#1528)** — the PT1 route B admission itself. The largest of the four: it is what
  makes a T1 lane openable from a contained workstation, and it was written so the live-DB
  obligation cannot be dropped by omission (missing, malformed, and *token-says-yes /
  manifest-says-nothing* all fail closed). See the section above.
- **UTV2-1857 (#1537)** — registered `apps/api/CLAUDE.md`, `apps/smart-form/CLAUDE.md` and
  `docs/03_product/**` in `.lane/lanes/governance.yml`, which is what unblocked #1521 without a
  head-pinned human artifact.
- **UTV2-1849 (#1527)** and **UTV2-1855 (#1533)** — the previous plan reconciliation, and the units
  stepper clamp plus the dead-odds-validator deletion.

Before them, **UTV2-1848 (#1526)** landed the enforcement half of
`PT1_CONTAINMENT_ADMISSION_DECISION.md` Part 2 *before* the admission decision it protects —
deliberately, so the reserved decision became a yes/no on a small diff whose protection already
existed on `main` rather than a decision to build one. What it landed:

- `shared.ts` — an optional `LaneManifest.t1_live_db_precondition` field with the single legal
  value `deferred_to_ci`, plus two `validateManifest` rules: an unrecognised value is an error
  (never silently ignored), and the field is an error at any tier other than `T1`.
- `truth-check-lib.ts` — a new closeout check **`G6`** which, when the field is present, requires
  both `verify` **and** `Writable DB proof (staging only)` to be green *on the merge SHA*. Absent
  field → `skip`; unrecognised value, no merge SHA, unreadable checks, or a non-green receipt →
  `fail`. Both contexts are asserted directly rather than relying on `verify`'s `needs:` edge, so a
  later loosening of that relationship cannot silently satisfy the gate.
- Spec rows in `TRUTH_CHECK_SPEC.md` and `LANE_MANIFEST_SPEC.md`, and §6a of
  `PT1_CONTAINMENT_ADMISSION_DECISION.md` carrying the exact remaining admission diff.

**That sequencing worked and is worth reusing.** UTV2-1848's acceptance test read all 752 lane
manifests on the branch and required that zero carried the field, so the gate was provably inert
until the decision was taken — and when it was taken, one lane was enough to take it.

Before it, **UTV2-1688 (#1519, `949459fea`)** held the slot: the executor-result namespace repair.
Chosen because it was not new debt — filed 2026-08-09, PM-authored, already tier-labelled, and until
it landed every `bootstrap/` lane was permanently unmergeable without an admin bypass. Staffing an
existing canonical issue that blocks merges outranks opening a fresh one.

**UTV2-1840** (#1518, `e4dcb59ee`) preceded it, moving a repo-minted `WORK-###` task from *cannot
start* to *cannot finish*; then UTV2-1838 (#1517, `3eea8f258`), UTV2-1836, UTV2-1830 (#1502) and
UTV2-1829 (#1499). RMA is an architecture review, not a governance lane.

Per the ratified debt policy in `intent.md`, **the slot is a ceiling, not a quota, and may stand
empty.** It is deliberately left unstaffed now: the Milestone 1 path's remaining blocker is a
reserved dispatch, not a governance defect, and the strongest available product work outranks it.

**The strongest candidate when the slot is next spent is the lease-reclaim terminality gate, now at
five recorded occurrences** — UTV2-1830, UTV2-1835, UTV2-1838, UTV2-1840 and, on 2026-09-08,
UTV2-1849, whose lease refused UTV2-1858's lane start (`lease_conflict Requested scope overlaps
active lease for UTV2-1849`) while its own manifest read `done` on `main` and its `owner_pid` was
`null`. Reclaim is purely TTL-gated (`lease-registry.ts:523-531`), so a provably finished lease
stays unreclaimable for 48 hours and `ops:lease release` is the only escape. `findLeasesHeldByTerminalLanes`
(`:769-800`) already computes exactly the predicate the reclaim path should be using. The
`pre-proof-validator` classification repair recorded under Learned is the second candidate.

---

## Tracker-independence cutover (ratified 2026-09-05)

Ratified by Griff on 2026-09-05 and recorded in `intent.md` § "Execution must not depend on the
tracker". **One supporting workstream, five exit conditions, then closed.** It is not a governance
audit and not a replacement framework.

The rule: an ordinary product task must run discovery → delegation → verification → PR → closeout
**without Linear access and without an issue ID**. Auto-setting labels and states is insufficient;
the test is what happens when Linear is unavailable, inconsistent, or at its cap.

### Evidence already in hand, measured on this lane

Recording this lane's own friction, because it is the cheapest available reproducer:

- **A transient Linear network blip hard-blocks lane start.** `ops:lane-start UTV2-1833` failed with
  `lane_start_failed: failed to capture Linear task contract for UTV2-1833: spawnSync curl
  ETIMEDOUT`. Nothing about the work required the tracker; a timeout on a metadata fetch stopped it.
  This is exit condition 2's failure mode, observed live.
- **A failed lane-start leaves residue the sanctioned cleaner refuses to clean.** The ETIMEDOUT
  attempt had already created the branch and worktree, so the retry failed with "Branch and worktree
  already exist but no manifest exists for this issue". `ops:lane-clean --issue UTV2-1833 --dry-run`
  returned `BLOCKED` with an empty `actions[]` and no reason — it is a post-merge cleaner, and an
  aborted lane start is outside its model.
- **A merged, truth-closed lane leaked its lease and blocked the next lane on the same files.**
  UTV2-1830 merged as #1502 (`1cb31a43e`) and truth-closed at 03:10Z, but `.ops/leases/UTV2-1830.json`
  stayed `active` with a 48-hour TTL and a dead owning PID (58934). `ops:lease-recover` refuses it —
  reclaim is TTL-gated — so a lease that is provably finished cannot be reclaimed for two days.
  `ops:lease release` was the working path.
- **Proportional validation exists but excludes the mission docs.**
  `scripts/ops/preflight.ts:1626-1631` admits only `docs/06_status/**` and `.claude/commands/*.md`
  to `--docs-only-fast-path`. Editing `docs/mission/intent.md` — the most authority-bearing docs edit
  in the repo — therefore requires the full application test suite (~4 min) to *begin*, while editing
  a status file does not. Same defect class as the `docs/mission/**` lane-authority gap UTV2-1829
  fixed: an allowlist that reads as if it covers a path it does not name.
- **Linear writes are not read-your-writes.** A tier label and state written at 14:54:50Z were not
  visible to a preflight Linear query started immediately after, costing one full ~4-minute run.
- **A lane can run start → merge with its Linear state never moving, and only closeout notices.**
  `truth-check` L3 refuses a lane whose issue is in an `unstarted` state. Nothing earlier checks
  it — preflight, `verify`, ERV, Merge Gate and the merge itself all pass — so the first signal is
  `post-merge-lane-close.yml` going red *after* the code is on `main`. Observed on UTV2-1838
  (`Ready for Claude`) and previously on UTV2-1824 (`Backlog`). Recovery is a state change plus a
  replay, ~4 minutes, no code change. This is also a precise measurement of the cutover's shape:
  L1/L3/L4/C1/C7 skip when `tracker_ref` is **null**, not when the tracker is merely *stale*, so a
  present-but-unmoved tracker remains a hard closeout dependency.
- **A merged, truth-closed lane leaked its lease for the third recorded time.** UTV2-1838 closed at
  `3eea8f258` with its `.ops/leases/UTV2-1838.json` still `active`, `owner_pid: null`, TTL to
  2026-09-08, which refused the next lane on the same files with `lease_conflict`.
  `pnpm ops:lease release --issue <ID> --actor claude --reason "<why>"` is the working path; both
  flags are required and their absence reports `lease_missing_required_fields` rather than usage.
  Reclaim stays TTL-gated, so a provably finished lease is still unreclaimable for 48 hours.
- **`preflight` PL3 and `truth-check` L3 are inverses, and only `lane-start` may cross between
  them.** PL3 refuses to issue a token when the issue is in a *started* state (`issue state In
  Claude is not startable`); L3 refuses closeout when it is in an *unstarted* one. So the obvious
  defence against the L3 failure recorded above — set the state before opening the lane — makes the
  lane unopenable, and `lane-start` will not run without a validated token. Measured on UTV2-1688,
  2026-09-06: two full ~4-minute preflight runs, one to discover it and one to undo it. The tracker
  is a hard dependency at *both* ends of an ordinary lane, and the two ends disagree about what it
  must say.

- **`--files` and `PG2` deadlock on any file the lane will create.** `ops:lane-start --files`
  refuses a path that does not exist yet; pre-creating it then fails preflight `PG2` (*working tree
  is not clean*). Only a **trailing** `/**` glob is legal in a scope declaration, so the only way
  out is to widen the lock to the whole directory — `scripts/ops/**` on this lane, where the actual
  change was three files. `file_scope_lock` is pinned at lane-start and an agent cannot narrow it
  afterwards either, so the cost is paid as permanently looser scope than the work needed.

None of these are risk controls. Every one is administrative.

### Exit conditions

Per `intent.md`, the cutover closes when all five hold, demonstrated rather than asserted:

1. A representative ordinary task can complete without Linear.
2. Optional tracker failures cannot block it.
3. Reserved-risk changes still require appropriate approval.
4. Fresh and compacted sessions recover the mission and current plan.
5. Existing PRs can finish without administrative restarts.

Then the capacity returns to product work.

**Measured 2026-09-08 — where the five actually stand.** The workstream is *not* complete, and it
is not complete for reasons that are now specific rather than general:

| # | State | Evidence |
|---|---|---|
| 1 | **Advanced, not closed** | A repo-minted `WORK-###` task could not *open* a lane: a credential-free `ops:preflight WORK-902` reported `PE2 skip` and `PL1 skip` — every tracker check correctly optional — and then **`PX2 fail`**, because `branch-discipline-guard.ts` kept a private copy of the identifier alternation never widened when `WORK-###` was minted, and `lane-start` refuses without a validated preflight token. UTV2-1840 repairs that; the same probe now reports `PX2 pass`. **It does not make the rest of the lifecycle `WORK-###`-clean** — see the enumeration below. |
| 2 | **Holds** | The credential-free probe reaches a verdict at all: `PE2`/`PL1`-`PL5` degrade to `skip`, not `fail`. |
| 3 | **Holds, unchanged** | Nothing in this workstream has touched merge authority, the merge gate, CODEOWNERS or branch protection. Items 8–11 of the change set remain RESERVED and unimplemented. |
| 4 | **Demonstrated repeatedly, still not proven mechanically** | This session has recovered mission and plan across several compactions, each time from `CLAUDE.md`'s `@`-includes plus live measurement rather than from carried context. No test asserts it, and until one does this row is an observation about a session, not a property of the system. |
| 5 | **Demonstrated repeatedly, and once *not*** | Eleven lanes have closed since 2026-09-06 — #1522, #1523, #1525, #1526, #1527, #1528, #1529, #1530, #1531, #1533, #1535 — the great majority on the first closeout attempt with no replay, no state repair and no manifest repair. The exception is instructive: **UTV2-1857 (#1537) needed two dispatches**, and the first failed with `"code": "pr_sha_mismatch"` because it was given the optional `pr` input. `lane-close.ts:632` refuses the explicit-PR path whenever `manifest.commit_sha !== pr.mergeSha`, which is the state *every* merged lane is in — `commit_sha` can only hold the last implementation commit, since the merge SHA does not exist until after the merge. The inferred path (no `pr` input) has no such check and closed it. So: **re-dispatch `post-merge-lane-close.yml` with `issue_id` alone**; the `pr` input is documented "trusted missing-binding repair only" and should be taken literally. |

**Where `WORK-###` still fails, enumerated rather than assumed.** `grep -rn "UTV2|UNI" scripts/
.github/` returns **22 sites** carrying the narrow alternation. They are not equivalent, and the
distinction is what says how much of exit condition 1 is left:

- **Deliberately narrow, correct as written (1).** `shared.ts:415` `TRACKER_REF_PATTERN`, with the
  comment *"A tracker key is a Linear issue identifier. `WORK-###` is deliberately NOT one."* This
  one must stay.
- **Hard refusals that would block a `WORK-###` lane after it opens (2).**
  `executor-result-validate.ts:109` pushes `Invalid Issue ID … Must match UTV2-NNN or UNI-NNN`.
  `proof-rebind.ts:1652` refuses with `proof_rebind_refused`; that one is a path-traversal guard on
  a value used as a directory segment, so it must be widened carefully rather than relaxed.
  **Corrected 2026-09-06 (UTV2-1688): the first of those two is not the required check, and the
  parenthetical "and ERV is a *required* check" made it read as though it were.** See the
  correction below — `executor-result-validate.ts` is reached by nothing but its own test file.
- **Soft degradations (2).** `proof-schema.ts:326` returns `unverified` and
  `proof-binding-validator.ts:150` returns a null binding context. Neither hard-fails; both quietly
  stop verifying, which is its own problem.
- **Discovery and reconciliation, non-blocking (5).** `queue-lib.mjs`, `lane-maximizer.ts`,
  `orchestration-reconciler.ts`, `truth-check-lib.ts:2613` (cross-issue commit scanning, which
  simply would not see a `WORK-###` reference).
- **Reserved surfaces, deliberately untouched (7).** `merge-gate.yml:244`,
  `executor-result-validator.yml:206`, `p0-protocol.yml:53`, `tier-label-check.yml:38,119`,
  `tier-label-apply.yml:90`, `merge-gate-verdict.cjs:30`. These are cutover items 8–11 and remain a
  PM decision on merge authority.

So exit condition 1 moves from *"a `WORK-###` task cannot start"* to *"a `WORK-###` task cannot
finish"*. **The cutover does not close because a helper merged** — 4 and 5 still require
demonstration, and the tracker remains a hard dependency at closeout (`truth-check` L3, above) for
any lane that *has* a tracker ref at all.

**Corrected 2026-09-06 (UTV2-1688): "the two hard refusals above are the next non-reserved step"
was wrong about the first of them, and the error matters because it mislocates the whole exit
condition.** PR A below names `scripts/ops/executor-result-validate.ts:133-158` as its
*"highest-value hunk: without it no branch reaches a green `Executor Result Validation` without a
`UTV2-###`."* Measured on `main` `66fb0d6a2`, `grep -rn "validateExecutorResultFields"` across the
repository returns exactly two consumers — its own definition and
`scripts/ops/executor-result-validate.test.ts`. The script's only CLI command is
`resolve-check-name`, which is all `executor-result-validator.yml:103` invokes it for.

**The required check validates fields from an inline duplicate**, at
`.github/workflows/executor-result-validator.yml:206-223`, inside an `actions/github-script` block
that cannot import a TypeScript module. Taking PR A's script hunk would change what the unit tests
assert and nothing whatsoever about what can merge.

This was diagnosed and filed on 2026-08-09 as **UTV2-1688**, which states it in as many words:
*"The copy that actually gates merges is the one inline in the workflow. Fixing only the script
would make the tests pass while the gate stayed broken."* Re-deriving it here cost a repository
sweep that reading the issue would have answered — the cost `Learned` already names, paid again.

Two consequences, and they point in opposite directions:

- **Exit condition 1 cannot be closed by ops-script work.** The identifier the required check
  admits is defined inside a required-check workflow, so widening it for a repo-minted `WORK-###`
  identity is a change to what a required check requires, and stays reserved with items 8–11.
- **The `bootstrap/` half of the same defect was never reserved and was never staffed.** UTV2-1688
  is PM-authored, already `tier:T2`, and its acceptance criteria explicitly exclude any change to
  required-check configuration, branch protection or bypasses. It widens which namespaces are
  legal while leaving every binding rule — `Branch:` equals the PR head ref, the declared PR equals
  the actual PR, the declared head SHA equals the current head — untouched. Until it landed, every
  `bootstrap/` lane was permanently unmergeable without an admin bypass, because the required
  context is created only by an EXECUTOR_RESULT comment and no valid one could be written.

  The lane also closes the drift itself rather than only its current symptom:
  `EXECUTOR_RESULT_ISSUE_ID_RE` and `EXECUTOR_RESULT_BRANCH_RE` are exported from the script, and
  the test suite now reads `executor-result-validator.yml` and asserts both inline literals are
  byte-identical to them. Mutation-checked three ways — reverting the script copy alone, reverting
  the workflow copy alone, and deleting the `Branch: == head ref` binding each turn a distinct
  assertion red. The second of those is the one that matters: before this lane, reverting only the
  copy that gates merges was invisible to every test in the repository.

**A new test file cannot be added without editing `package.json`, and that is a scope trap.**
`pnpm verify` fails closed with `WIRING_TEST_UNWIRED_NEW` on any `*.test.ts` not reachable from a
package script or workflow command, and the only wiring point is the `test:ops` script in
`package.json`. A lane that did not declare `package.json` at lane-start therefore cannot add a test
file at all: `file_scope_lock` is pinned and an agent cannot widen it. UTV2-1840 hit this and
resolved it by putting the eight tests in the already-wired `scripts/ops/shared.test.ts` — defensible
here, since the contract under test *is* that module's exported namespace list, but it is not a
general answer. **Declare `package.json` in the scope of any lane that may add a test file.**

### The dependency map — measured 2026-09-05

Two dependencies are routinely conflated, and separating them is what makes this workstream small:

**Linear the API hard-blocks in exactly two files** — `scripts/ops/preflight.ts` (which gates lane
*open*) and `scripts/ops/truth-check-lib.ts` (which gates lane *close*). Everything else that touches
Linear fails soft or is off the critical path. Remove the token and the first failure is
`ops:preflight` at `preflight.ts:1128-1136` (PE2 + PL1-PL5 `infra_error` -> verdict `INFRA` -> no
token written), which then cascades to `lane-start.ts:418` *"validated preflight token is
unavailable"*.

**The `UTV2-###` identifier is embedded far more deeply** — it is the primary key for the manifest
filename, sync filename, proof directory, branch name, worktree path, preflight-token path,
file-scope lifecycle grant, and the merge gate's tier lookup.

**The decisive finding: no required CI check calls Linear.** Of the four required checks, `verify`
and `P0 Protocol` pass on an ID-less branch; `Executor Result Validation` and `Merge Gate` fail — and
both fail on the *name*, not on the tracker. `merge-gate.yml:250,419-424` resolves tier from
`docs/06_status/lanes/<ID>.json`, never from Linear. **Linear is the authoring surface for tier, not
the gate's input** — the risk decision is already repo-local by the time it matters.

One inversion worth recording: `P0 Protocol` is the *only* required check that ever touches Linear
(`p0-protocol.yml:75-78`, `exit 1` when the token is absent and an ID is present). So removing Linear
would make correctly-named branches *worse off* than ID-less ones.

Two administrative gates deserve naming:

- **`truth-check` L4** (`truth-check-lib.ts:1033-1037`) requires `manifest.pr_url` to appear in the
  issue's Linear attachments. **Nothing in this repository ever creates that attachment** — `grep -rn
  "attachmentCreate" scripts .github` returns nothing. L4 is satisfied exclusively by Linear's native
  GitHub integration, which keys off the `UTV2-###` in the branch name. A hard closeout gate depends
  on a third-party integration the repo neither owns nor exercises.
- **`truth-check` L2** (`:1012-1017`) does not merely check the tier label — it *overwrites* the
  manifest tier from Linear. That is the risk-bearing half, and relocating it is the one item here
  that needs PM sign-off on its own.

**On the classifier as a floor:** `tier-classifier.ts:76-92` `classifyMechanicalMinimum(paths)` is
pure — no Linear, no network, no git — and `classifyDerivedTier` at `:94-117` already computes
`maxTier(declaredTier, mechanicalMinimum)`, i.e. exactly floor semantics. But it is **binary, not
three-valued**: every match hard-codes `minimum_tier: 'T1'` and the reduce seeds `'T3'`, so **no path
can ever produce T2**. It cannot express the middle tier at all, and it is blind to semantic risk,
diff magnitude, and blast radius. It is a usable floor and an unusable replacement — which is exactly
what the ratification says.

**The change set, split by whether it touches reserved surface:**

| # | Change | Reserved? |
|---|---|---|
| 1 | `preflight.ts:1119-1148,1161` — emit PL1-PL5 as `skip` (not `fail`/`infra_error`) when there is no tracker ref or token; take tier from `--tier` raised by the mechanical floor | No — highest leverage; unblocks the whole open->PR path |
| 2 | Add `tracker_ref` to the manifest and widen `shared.ts:365,372,656` + the manifest schema so a repo-minted id is legal; `issue_id` becomes repo-owned identity and the Linear key becomes explicit and nullable | No for ops; **reserved** if `merge-gate.yml:243-245` must widen in lockstep — split that out |
| 3 | `truth-check-lib.ts` L1/L3/L4/C1/C7 -> `skip` when `tracker_ref` is null | No — all purely administrative |
| 5 | `lane-close.ts:2794-2803` and `lane-finalize.ts:948-953` — record `tracker_sync: skipped` instead of throwing out of closeout | No |
| 6 | `execution-packet.ts:1316-1323` — a `--description`/file source for the task contract, so a first capture needs no API | No — unblocks delegation |
| 7 | `lane-maximizer.ts` — document the existing queue-file/`--candidates` source as first-class | No — unblocks discovery |
| 4 | `truth-check-lib.ts:1012-1017` — relocate L2's tier authority to the manifest raised by the floor | **Adjacent** — risk-bearing; PM sign-off; do not bundle |
| 8-11 | `p0-protocol.yml`, `executor-result-validator.yml`, `merge-gate.yml`, classifier Phase 2 cutover | **RESERVED — not changed** |

**Items 1, 3, 5, 6 and 7 together satisfy the ratified rule for the ops-script half of the lifecycle
with zero merge-authority exposure.** Items 8-11 are where the remaining hard blocks live, and all
four are reserved. That is the real shape of the decision: the tracker can be made optional for
discovery, delegation, verification and closeout by an ordinary lane; making it optional for *merge*
is a PM decision on branch protection and the merge gate.

**Defect found in passing, worth reporting regardless of this workstream:**
`executor-result-validator.yml:181-184` — on `pull_request` with no executor-result comment it logs
*"No executor result comment found. Check stays pending."* and creates no check context. Because
`Executor Result Validation` is a required check, the PR sits BLOCKED **with no red check to look
at**. That is the mechanism behind the already-recorded "a PR can sit BLOCKED with everything green"
class.

### Sequencing — reviewed against #1491 and #1492 on 2026-09-05

**Structural finding that changes how both PRs read:** #1492 is stacked on a *stale* base of #1491
(`git merge-base 73fb6b76e 77dea9c8d` = `2641d7cae`; #1491 has 7 commits after it). A naive
`git diff 73fb6b76e 77dea9c8d` therefore *falsely* shows #1492 reverting #1491's security hardening
in `merge-authority.cjs` and `RESERVED_RISK_SURFACES.json`. Those are stale-base artifacts. #1492's
true diff is `2641d7cae..77dea9c8d` and touches none of those files.

The split is cleaner than expected: **merge authority lives almost entirely in #1491; tracker
independence lives almost entirely in #1492.** The one coupling to break is that #1492 sources its
*risk semantics* from #1491's classifier.

**PR A — the tracker-independence unblock.** Touches no reserved surface:

- `scripts/ops/executor-result-validate.ts:133-158` — absent issue ID passes, malformed still fails,
  and the load-bearing assertion (the executor attests to *this* head ref) is kept. Highest-value
  hunk: without it no branch reaches a green `Executor Result Validation` without a `UTV2-###`.
  **Do not** take the same file's `proofArtifactRequired(r, reservedSurface)` rewrite, which makes
  the classifier the *sole* evidence bar — under this ratification it must be a floor: proof required
  if `tier != T3` **or** the diff touches a reserved surface.
- `scripts/ops/branch-discipline-guard.ts:11,132-158` — a branch with no issue ID passes, while a
  branchless PR referencing two issues still fails and an ID-carrying branch must still bind to its
  own. Not a required check.
- `.github/workflows/tier-label-check.yml:41-53` — `core.setFailed` -> `core.notice`. This is what
  produces the *"No issue ID found... Cannot resolve authoritative tier"* red on eight open PRs. Not
  one of the four required checks, so it changes no merge authority, and it still mirrors the tier
  for any branch that does carry an ID — remaining sync stays optional and non-blocking.
- Hook and settings removals of mandatory tracker lookups: delete
  `.claude/hooks/commit-msg-linear-check.sh` and `linear-sync-reminder.sh` and their
  `.claude/settings.json` wiring; drop the `pnpm linear:issues` reminder in `artifact-drift-check.sh`
  and the lane-heartbeat scan in `session-summary.sh`. All advisory. Take the *removals* verbatim;
  **rewrite** `session-start.sh`'s replacement body, whose new text asserts RMA.
- `scripts/ops/classify-diff.ts` — a read-only preview CLI that exits 0 for both verdicts, stating
  outright it is not the gate. Take it, renaming its verdict labels away from `auto`/`human` so it
  does not read as an authority claim.

**PR B — the floor rework.** Where the real care is needed:

- `scripts/ops/merge-authority.cjs` `classifyDiff`/`loadPolicy` are pure, read-only functions and are
  reusable as the **mechanical risk floor**. Take `RESERVED_RISK_SURFACES.json` `surfaces[]` only.
  **Leave behind** its `approval` block and `summary` (they *are* the merge-authority definition) and
  its `scopeNote`, which declares `packages/domain`, `packages/contracts`, scoring and lifecycle
  deliberately **not** reserved — that is precisely the risk-lowering this ratification forbids.
  Never import `evaluateMergeAuthority`.
- `.claude/hooks/tier-c-path-guard.sh` hard-denies writes to `packages/domain/**`,
  `packages/contracts/**`, `apps/worker/**`, `apps/api/src/auth.ts` and `supabase/migrations/**`, and
  **its only bypass is an active lane manifest's `file_scope_lock`**. Under a no-issue-ID model that
  guard denies those edits with no way to authorize them, so execution stops at the keyboard. #1492's
  `reserved-surface-guard.sh` fixes the unblock but **demotes the hard block to advisory**, justified
  by "the merge gate blocks it instead" — a justification that does not hold here, because the merge
  gate is not changing. Salvage the mechanism (one shared classification source for keyboard and
  gate) and keep reserved paths blocking, authorized by a declared scope rather than a manifest.
- `scripts/ops/codex-packet.ts` is the **repository-owned work identity**: a packet file with
  required `Goal` / `Scope` / `Acceptance` / `Do not touch` sections that the runner refuses to
  execute without, reading no Linear, no manifest and no tier label. Its `classifyScope` fails closed
  on unclassifiable scope, and a broader scope must be at least as reserved as anything inside it —
  floor semantics done correctly. Verify `resolveProfileForScope` only ever *tightens*.

**Do not take** #1492's `CLAUDE.md`, `AGENTS.md`, command or agent rewrites. Beyond restating RMA as
doctrine, #1492's `CLAUDE.md` **deletes `## Mission — mandatory context`** — the block that
`@`-includes `intent.md`, `spec.md`, `plan.md` and `STANDING_GUARDRAILS.md`. Taking it wholesale
would silently stop loading the very sections this lane adds. Re-derive by hand against `main`.

**Dangling references to be aware of:** #1492 cites a `## Execution primitive` section of
`intent.md` in roughly six load-bearing places (`RESERVED_RISK_SURFACES.json:4`,
`reserved-surface-guard.sh:19`, `tier-label-check.yml:44-48`, `branch-discipline-guard.ts:126-131`).
**No such section exists on `main`**, and `## Changes to the operating model` says the opposite.
Every one of those citations is currently false.

### The reserved `WORK-###` executor-result diff — prepared, not applied (UTV2-1688)

Per `intent.md` § "How a reserved decision is surfaced": the dependent work is staged and verified
as far as existing authority allows, and one recommendation is stated with its exact inputs.

**What is already done and needs no decision.** UTV2-1688 widened both copies of the
executor-result field validation to recognize `bootstrap/`, and made the duplication self-policing:
`EXECUTOR_RESULT_ISSUE_ID_RE` and `EXECUTOR_RESULT_BRANCH_RE` are exported from
`scripts/ops/executor-result-validate.ts`, and two tests read
`.github/workflows/executor-result-validator.yml` and assert its inline literals are byte-identical
to them. Reverting **only** the workflow copy now fails the suite; before, nothing caught it.

**What is reserved.** Admitting a repo-minted `WORK-###` identity into a *required* check changes
what that check requires. That is reserved decision 7, and it is cutover items 8–11. The change is
two words:

```diff
-export const EXECUTOR_RESULT_ISSUE_ID_RE = /^(UTV2|UNI)-\d+$/i;
-export const EXECUTOR_RESULT_BRANCH_RE = /^(claude|codex|bootstrap)\/(utv2|uni)-\d+/i;
+export const EXECUTOR_RESULT_ISSUE_ID_RE = /^(UTV2|UNI|WORK)-\d+$/i;
+export const EXECUTOR_RESULT_BRANCH_RE = /^(claude|codex|bootstrap)\/(utv2|uni|work)-\d+/i;
```

plus the byte-identical edit to the inline copy at `executor-result-validator.yml:216,223`, which
the drift tests already force to happen together. The error strings widen to name `WORK-NNN`.

**What it does and does not do.**

- It does **not** make an absent issue ID pass. Every executor result still declares an identifier,
  and the `Branch:` value must still equal the PR head ref, the declared PR must still equal the
  actual PR, and the declared head SHA must still equal the current head. This is the specific line
  #1492 crosses and this diff does not: #1492 makes an ID-less branch legal, which is a different
  and larger decision.
- It does **not** touch required-check configuration, branch protection, CODEOWNERS, the merge gate,
  tier semantics or approval policy.
- It admits an identifier the repository *already mints* — `shared.ts` `BRANCH_PATTERN` has accepted
  `work-\d+` since UTV2-1837, and `ISSUE_ID_NAMESPACES` since UTV2-1840.

**What it still would not close.** Exit condition 1 also needs `proof-rebind.ts:1652`
(non-reserved; a path-traversal guard, widen carefully) and the closeout gates. This diff removes
the *required-check* blocker, not the last blocker.

**Recommendation:** approve it as a bounded namespace widening. Non-secret success criterion — after
it lands, a `WORK-###` lane's EXECUTOR_RESULT comment produces a green `Executor Result Validation`,
and the three controls in `executor-result-validate.test.ts` (head-ref mismatch, PR mismatch, stale
head SHA) still fail on the conditions they name. Both are mechanical and already written.

### Explicitly out of scope

Merge authority, the merge gate, its policy inputs, CODEOWNERS, and branch protection are reserved
and unchanged. #1491's diff-classified merge authority is **not** approved by this ratification and
remains a separate architecture decision. Existing enforcement stays active until reviewed
replacements land.

## Admissibility debt

**Six** open PRs cannot be evaluated by `Merge Gate` because they were opened outside the lane
system and carry no resolvable tier: #1429, #1491, #1492, #1495, #1496, #1498. All six fail the
identical set of checks — `Check issue references`, `Sync tier label`, `Executor Result Validation`,
`Merge Gate` — every one of them downstream of the same single cause: no `UTV2-###` in the branch,
so no tier can be resolved.

**PM ruling 2026-09-03: `Merge Gate` is not changed to admit incorrectly-created branches.** The fix
is readmission through `ops:lane-start` under the real issue. Renaming an open PR's head branch
closes it and it will not reopen, so readmission means a replacement PR carrying the same diff.

**The count fell from eight because the readmission ruling worked, twice.** #1493 and #1494 were the
two security fixes in this set that already had canonical Linear owners — the work and the issue
existed, they were simply never joined. Both were re-homed and closed:

| Former PR | Fix | Canonical issue | Outcome |
|---|---|---|---|
| #1493 (+121/-1) | a dot in the path no longer skips Command Center authentication | **UTV2-1812** | landed as **#1503**, `9ac4694d9` |
| #1494 (+503/-61) | the management token can no longer be handed arbitrary SQL | **UTV2-1802** | open as **#1513**, green `verify`, awaiting a T1 verdict |

That is the readmission path demonstrated end to end rather than argued: an inadmissible PR carrying
real work becomes an ordinary governed lane, and the gate never had to change.

### `Lane authority` rejects dotfiles inside its own allowed globs

Observed on this lane (UTV2-1829, PR #1499). `ops:lane-start` creates and commits
`docs/06_status/proof/<issue>/.gitkeep`. `File scope lock` accepted it; `Lane authority` and
`Return review packet` both rejected it as `out-of-scope files:
docs/06_status/proof/UTV2-1829/.gitkeep` — even though `.lane/lanes/governance.yml` lists
`docs/06_status/proof/**` as an allowed glob.

**Correction, 2026-09-05: the recorded micromatch diagnosis was wrong.** This plan previously stated
that `matchesAny()` in `scripts/lane-contract.ts` calls `micromatch.isMatch()` with no `dot` option.
It does not. `scripts/lane-contract.ts:214` reads:

```ts
return micromatch.isMatch(file, patterns, { dot: true });
```

`{ dot: true }` is present, and was present in the original commit `8477d8dbb`. Every other call site
passes it too — `ut-cli/lib/git.ts:82`, `ut-cli/lib/scope.ts:24/28/31`,
`scripts/ci/direct-main-push-guard.ts:184`, `scripts/ops/pr-review-packet.ts:656/671/960`. Whatever
rejected `docs/06_status/proof/UTV2-1829/.gitkeep` was **not** this option, and the fix this plan
proposed would have been a no-op.

**Cause identified 2026-09-05 (UTV2-1836), and it is not about dotfiles at all.** The same check
rejected `docs/06_status/proof/UTV2-1835/evidence.json` on PR #1511 — an ordinary filename. That
ruled out every dot-related explanation and pointed at the scope construction itself.

`scripts/ops/pr-review-packet.ts:487-491` builds the allowed scope as:

```ts
const allowedFileScope = normalizePaths([
  ...scopeLock,
  ...sameIssueLaneMetadataPaths(issueId),   // .ops/sync/<ID>.yml and docs/06_status/lanes/<ID>.json only
  ...expectedProofPaths,                    // an EXACT list, not a glob
]);
```

`sameIssueLaneMetadataPaths` (`:662-668`) covers the sync file and the manifest and **no proof
glob**. So the lane's own proof directory is admitted only by literal `expected_proof_paths`
entries, and any other file inside it is scope bleed. `.lane/lanes/governance.yml`'s
`docs/06_status/proof/**` glob governs `Lane authority`, not this packet.

The system contradicts itself here in two directions, and both were hit on one lane:

- **`ops:lane-start` itself creates `docs/06_status/proof/<ID>/.gitkeep`** and commits it, then the
  review packet rejects it.
- **`Executor Result Validation` selects the narrow legacy proof contract unless
  `docs/06_status/proof/<ID>/evidence.json` exists** — and that contract requires a real merge SHA
  pre-merge, which is impossible. So a lane must add `evidence.json` to pass ERV, and adding it
  fails the review packet.
- **`ops:lane-manifest update` cannot add either one.** It supports `--pr-url`, `--commit-sha` and
  `--files-changed`; `expected_proof_paths` is settable only at `create` (`lane-manifest.ts:128`).

`Return review packet` is not one of the four required checks, so this blocks no merge — it emits a
`FAIL` verdict on a correctly-constructed bundle. The repair is one of: give the packet a
`docs/06_status/proof/<ID>/**` glob the way `sameIssueLaneMetadataPaths` already does for the sync
file and manifest, or teach `ops:lane-manifest update` to extend `expected_proof_paths`. Recorded
here rather than filed, per the filing threshold.

The earlier micromatch reading above stands corrected on its own terms as well: `{ dot: true }` was
always present, and the fix this plan once proposed would have been a no-op.

### Four non-required gates fail a correctly-constructed T3 lane, by two different mechanisms

Measured on this lane (UTV2-1846, PR #1524, T3), and it is a distinct defect from the review-packet
scope bleed above rather than another instance of it.

**Four** non-required checks are red on this PR. All four trace to the same underlying situation —
a T3 lane that correctly declares no proof obligation — but they reach it by two different
mechanisms, and conflating those is what made the first draft of this section propose a repair that
would have fixed one of the four.
`Close Eligibility Preflight` reported `BLOCKED` with six failures — CEP-E1 (*manifest declares no
expected_proof_paths*), CEP-E3, CEP-E4/P11, P12, P13, P14 — and then CEP-C1: *"ops:lane-close would
fail after merge on: CEP-E1, CEP-E3, CEP-E4/P11, CEP-E4/P12, CEP-E4/P13, CEP-E4/P14"*. `Proof Gate`,
`Proof Auditor Gate` and `Runtime Verifier Gate` each failed on the same fact stated three ways:
*"Proof dir contains no markdown files"*, and *"No markdown files found in proof dir:
docs/06_status/proof/UTV2-1846"*.

**That prediction is false, and the contradiction is inside one file.** The gate CEP-C1 claims to
predict is `truth-check-lib.ts:1004`:

```ts
if ((tier === 'T1' || tier === 'T2') && manifest.expected_proof_paths.length === 0) {
  addCheck('M7', 'fail', 'expected_proof_paths must be non-empty for T1/T2');
} else {
  addCheck('M7', 'pass', 'expected_proof_paths satisfies tier requirement');
}
```

M7 is explicitly tier-aware and **passes T3 with an empty list**. CEP-E1, at `:570-577` in the same
module, reads `input.manifest.expected_proof_paths ?? []` and fails on empty with no tier condition
at all. So a correctly-constructed T3 lane — `defaultProofPaths` (`shared.ts:932-942`) returns `[]`
for T3 by design, and `executor-result-validator.yml:249-255` accepts `Proof Artifact: CI only` for
T3 on the same basis — is told its closeout will fail when it will not.

Confirmed against history rather than by reading alone: seven T3 manifests on `main` (UTV2-953, 975,
977, 983, 991 `done`; 955, 958 `closed`) all carry `expected_proof_paths: []`, and all closed.

All four are non-required, so this blocks no merge. But the failure mode is worse than the
review-packet one it superficially resembles: that check emits a `FAIL` verdict on correct work,
whereas CEP-C1 emits a **specific false prediction about a future gate**, which is exactly the kind
of output an operator is meant to act on.

**Three of the four fire on an artifact `ops:lane-start` creates itself.** Each of the three proof
gates has an applicability escape, and they are not the same mechanism — a distinction worth stating,
because it decides which repair fixes which gate:

| Gate | Applicability trigger | Escape |
|---|---|---|
| `Proof Gate` | the PR **diff** adds/modifies a path under `docs/06_status/proof/` (`:132-139`) | `-z "$proof_dirs"` → *"No proof directories changed — trivial pass"* |
| `Proof Auditor Gate` | the same diff derivation (`:68-77`) | `-z "$changed_proof_dirs"` → *"gate passes trivially"* |
| `Runtime Verifier Gate` | the proof **directory exists** on the head checkout (`:59-61`) | `! -d "$PROOF_DIR"` → *"gate not applicable for this PR"* |
| `Close Eligibility Preflight` | the **manifest** for the branch's issue id (`:64-73`) | only a branch with no issue id, or no manifest |

So none of the first three is *meant* to fire on a lane with no proof obligation. On this lane the
sole tracked file under `docs/06_status/proof/UTV2-1846/` is the empty `.gitkeep` that
`ops:lane-start` committed. That one zero-byte file puts a proof path in the diff *and* makes the
directory exist — it is the entire difference between three red gates and three trivial passes.

**`Close Eligibility Preflight` is not in that group**, and an earlier draft of this section was
wrong to imply otherwise. CEP reads the manifest, never the proof directory, so deleting the
`.gitkeep` would not quiet it. The two repairs are therefore complementary, not alternatives, and
neither subsumes the other:

1. **For CEP only** — give CEP-E1/E3/E4 the same `tier === 'T1' || tier === 'T2'` condition M7
   already has. This was named as *the* repair in the first draft; it fixes exactly one of the four,
   because the other three never consult the tier at all.
2. **For the three proof gates** — stop `ops:lane-start` creating `docs/06_status/proof/<ID>/.gitkeep`
   for a lane whose `expected_proof_paths` is empty. It also removes an artifact the repo already
   knows is unsatisfiable: the review packet demands the `.gitkeep` be declared in scope while CEP-E2
   refuses it once declared, and `expected_proof_paths` is settable only at `create`.

Neither is done here: this lane's `file_scope_lock` is `docs/mission/plan.md` alone, and a lock
cannot be widened by an agent. Recorded rather than filed, per the filing threshold.

**Repair 2 is now confirmed empirically rather than argued.** UTV2-1849 (#1527) is the same shape as
UTV2-1846 — T3, `expected_proof_paths: []`, `docs/mission/plan.md` alone — and deleted the
`docs/06_status/proof/UTV2-1849/.gitkeep` that `ops:lane-start` had committed. On that PR
`Return review packet` **passes**, and so do `Proof Gate`, `Proof Auditor Gate` (skipping) and
`Runtime Verifier Gate`, where #1524 had all four red. `Close eligibility preflight` is still red,
exactly as the table above predicts: CEP reads the manifest and never the proof directory, so
removing the file cannot quiet it. The two repairs really are complementary, and the cheaper one is
already available to any T3 lane today — delete the `.gitkeep`.

One consequence for reading this plan's own PR: five of #1524's non-required checks are red — the
four above plus one — and none is an ordinary repair. `Branch Discipline Guard` reports `multiple_issue_references` — *"found
UTV2-1688, UTV2-1724, UTV2-1730, UTV2-1841, UTV2-1842, UTV2-1846"* — because a mission-plan commit
body necessarily cites the issues the plan reconciles. Rewriting those messages moves the head and
invalidates the executor result bound to it, which is the same trade #1479 made deliberately and for
the same reason.

### Closeout repeatability — UTV2-1838, and what it deliberately left undone

The failure this lane exists for was observed twice (UTV2-1835, UTV2-1836): `ops:lane-finalize
<ID> --pr <n>` halts at `generate_t2_proof_bundle`. `lane-finalize.ts` passes
`--verification-log docs/06_status/proof/<ID>/runtime-verification.md`, but `ops:proof-generate`
writes only `diff-summary.md` and `verification.md` (`proof-generate.ts:197`
`STANDARD_PROOF_FILES`). `readOptionalFile` called `fs.readFileSync` unguarded, *as a function
argument*, so a static-proof lane threw ENOENT before the generator ran — and that step is
`required: true`.

**That crash was the only thing preventing a data-loss bug, which is why the two repairs had to
land together.** `lane-finalize.ts` always passes `--force`, and with `--force` the writer put the
same Markdown blob into **every** entry of `expected_proof_paths`. 27 T2-eligible manifests on
`main` declare a structured sidecar there (`evidence.json`, `model-routing.json`). Repairing the
ENOENT alone would have unmasked an overwrite that destroys machine-read proof artifacts. The
overwrite guard (`isMarkdownProofPath`, refusing before the `force` check) landed first, and the
inversion test asserts the sidecar's **content** is byte-identical after a forced run, not merely
that an exit code changed.

Two other repairs landed with them:

- **`lane-close.ts` — the plain close path was unguarded on `main`.**
  `guardRepairAgainstMainCheckout` (UTV2-1542) sits inside `if (repairMerged)`, so a plain
  `pnpm ops:lane-close <ID>` from the root checkout while on `main` reached `runTruthCheck`
  (history append + heartbeat write) and `finalizeLaneCloseManifest` (`status: done`) with no
  main-checkout guard at all. `guardCloseAgainstMainCheckout` now refuses it; `--repair-merged`
  keeps the richer guard that emits a governed repair packet, and the trusted post-merge
  automation is exempt from both.
- **Replay evidence parity.** `autoHarvestCiDbProofIntoEvidence` and
  `autoPopulateStaticProofFromVerifyRun` lived only in `proof-generate`'s `main()`.
  `post-merge-lane-close.yml:332-335` short-circuits the proof step on `workflow_dispatch` and
  delegates to `rebindRepairedLaneProof`, which called neither — so a dispatch replay bound its
  SHAs correctly but left `static_proof`/`runtime_proof` unpopulated and failed P7/R1/R2 on a
  replay that would have passed on a push. Both are now called from `rebindRepairedLaneProof`
  under the same best-effort, never-fatal contract they carry in `proof-generate`.

**One scoped item was deliberately not done, and one turned out not to need doing.** A lane's
`file_scope_lock` is pinned at lane-start and cannot be widened by an agent, and UTV2-1838's lock
covers `lane-close.ts`, `lane-finalize.ts` and `t2-proof-bundle.ts` — not these two files:

| Item | File | State |
|---|---|---|
| A provably terminal lane's lease cannot be reclaimed for 48h — reclaim is purely TTL-gated (`lease-registry.ts:523-531`, `claude` TTL at `:133`). Observed live on UTV2-1830: merged `1cb31a43e`, truth-closed, lease still `active` with a dead owning PID. `ops:lease release` is the working escape, but reclaim should not require knowing that | `scripts/ops/lease-registry.ts` | **Real, not done.** Gate reclaim on lane terminality, reusing `findLeasesHeldByTerminalLanes` (`:769-800`) rather than the clock. Out of scope; recorded, not filed |
| `truth_check_history` grows on every non-`done` run, so an infra-error early return records a `fail` for what was a token blip | `scripts/ops/truth-check-lib.ts` | **The defect does not exist.** See below |

**Corrected 2026-09-06: the `truth_check_history` defect this plan and UTV2-1838's own issue text
both asserted is not real, and the line numbers cited for it were stale.** The issue named
`truth-check-lib.ts:1860-1864` as a `done`-only guard and `:986`, `:1045`, `:1062` as infra-error
early returns. On current `main` those lines are unrelated code. Measured directly by calling
`finalizeWithManifest` with its injectable `writeManifestFn` and counting writes:

| Case | Writes |
|---|---|
| second close on a `done` lane, exit 0 | **0** |
| second close on a `done` lane, exit 1 | **0** |
| `infra_error` on a live lane, exit 3 | **0** |
| `ineligible` on a live lane, exit 2 | **0** |
| genuine `fail` on a live lane, exit 1 | 1 — correct, and the control that shows the probe can observe a write |

Every `infra_error` path uses `exitCode: 3` (`:919`, `:938`, `:955`, `:1097`, `:1595`), and
`finalizeWithManifest:1898` returns before any write on exit 2 or 3. That guard was introduced in
`4c029b006` on 2026-04-11 and the `done` guard in `7bcc642d7` (UTV2-1224) on 2026-06-06 — both
predate the issue. So this was never fixed recently; **it was wrong when written**, and acceptance
criterion 3 already holds on `main`. What is genuinely missing is a regression test locking it, and
that test file is also outside this lane's lock.

The lease item is survivable by hand today and blocks no production, so per the ratified filing
threshold it is recorded here rather than filed. It is the natural content of the next governance
lane if the slot is spent, alongside the `pre-proof-validator` classification repair under Learned.

The general lesson is the expensive one: **an issue's own file:line citations are a snapshot, and a
lane that implements against them without re-measuring implements against a stale repo.** Two of
the three citations here had drifted and the defect behind them was never real.

### `docs/mission/**` lane registration — resolved on `main`

`.lane/lanes/governance.yml` enumerates every docs subtree a governance lane may touch, and
`docs/mission/**` was in none of them, so `Lane authority` and `Return review packet` failed this
PR on `docs/mission/intent.md`, `spec.md` and `plan.md`. `CLAUDE.md` and `AGENTS.md` were already
individually admitted — a governance lane could add the pointer but never the target.

That file's own comments record this exact situation eight times (UTV2-1524, 1528, 1541, 1557,
1199, 1384, 1253, 1629), each closed by the lane that hit it adding its path in the same PR.
UTV2-1829 did the same, bounded to `docs/mission/**` and nothing else, and **#1499 merged at
`d70df077` on 2026-09-04**. The glob is on `main`; this lane (UTV2-1830) touches
`docs/mission/intent.md` and `docs/mission/plan.md` inside its own `file_scope_lock` and needs no
scope override for them.

The mechanism is worth keeping recorded: `.lane/lanes/governance.yml` was outside UTV2-1829's
`file_scope_lock`, and a lock is pinned to the lane-start commit and cannot be widened by an agent,
so the bounded expansion required a `scope-override/v1` comment authored by CODEOWNERS, pinned to an
exact head SHA. Every commit that moves the head — including a sanctioned `main` resync —
invalidates it. That is why a lane needing an override should be resynced and reconciled *before*
the override is requested rather than after.

### `MERGE_SHA: pending merge` — resolved on `main`

Executor Result Validation rejected the ratified `pending merge` anchor under the legacy contract,
which demanded the row be a real commit — impossible before a merge exists — while
`PLACEHOLDER_VALUE_PATTERN` in `ops:proof-generate` did not match `pending merge` either, so a
contract-conformant bundle was also unrebindable after the merge. Post-merge closeout was
deadlocked repo-wide.

**PR #1485 (UTV2-1825) merged at `5ed005a6d`.** Its own lane then closed cleanly through the normal
post-merge path (`5b5f7a3b8`), which is the mechanical evidence the rebinder now accepts the anchor.

The two lanes that merged before the fix landed have since been truth-closed through the governed
post-merge path. **UTV2-1789 (#1474)** closed at `43a1bf0f4` on the push that followed the fix.
**UTV2-1824 (#1488)** closed at `b729447d2`. Both manifests read `done` and
both issues are `Done`. No lane is left carrying the old failure.

UTV2-1824 needed one replay, and the rebinder was not what blocked it: every proof, merge and
evidence gate passed on the first attempt, and the single failure was `L3 — Linear state Backlog is
not an active or closeout state`. That issue had never left `Backlog` in its entire history — the
lane was started, implemented, reviewed and merged while its workflow state stood still. Correcting
the state and replaying closed it. A lane can therefore run end to end with its Linear state
untouched, and nothing surfaces that until closeout refuses.

The schema-v2 `sha_binding` block in `evidence.json` (`merge_sha: null` plus `verified_source_sha`)
remains the correct authoring shape; it is what the repaired rebinder binds against.

---

## Requires Griff

Consolidated from Wave 0, in dependency order. **Nothing on this list blocks Milestone 2's
critical path.** An earlier draft of this reconciliation said item 0 did; that was measured and
withdrawn before merge — see the correction at the end of "Executable now". Each item below blocks
only itself.

0. **Approve #1479** (UTV2-1815, T1, modeling) — null and zero stakes no longer compute as if they
   were a real unit size. `verify` and `Writable DB proof (staging only)` both green at
   `d180096cc`, `EXECUTOR_RESULT` posted and bound to that head, so a verdict binds a mergeable
   head rather than one that would need a resync afterwards. **Its three red checks are all
   non-required and all previously diagnosed** — the live-DB proof guard reads the PR *diff* while
   this lane's proof already sits on `main`; `Shadow Parity Check` needs a read-only production
   credential, which is a secret; and `Check issue references` names foreign refs in pre-existing
   commits, clearable only by a history rewrite that would move every bound anchor. It is listed
   first because it is the one item here whose *timing* interacts with Milestone 2: it shares
   `apps/api/src/grading-service.ts` with UTV2-1861, and landing it first spares a resync of a
   head-pinned T1 PR. It does **not** block that lane — its manifest is not on `main`, so `PL6`
   sees no overlap, and the two diffs share no lines.
1. **Approve #1513** (UTV2-1802, T1) — the Command Center management token can no longer be handed
   arbitrary SQL. Green `verify`. Pre-deployment hardening: the Command Center is in no production
   compose service and behind no Caddy route, so this closes a surface #1496 would create rather
   than a reachable one. It becomes load-bearing if Milestone 2 condition 5 is answered by
   deploying the Command Center, which is the current expectation.
2. **Approve #1484** (`pm-verdict/v1`) — canonical reference bootstrap, `verify` green.
3. **#1491 / #1492 architecture review** — merge authority and agent authority. Those two PRs only.
4. **#1451** — production DDL, `verify` currently red.
5. **Direct-`main` prevention** — branch protection change, decided on its own merits and its own
   timeline. **Not sequenced behind the inadmissible-PR backlog:** the prohibition is already in
   force, and incorrectly created PRs do not earn a deferral of a safety control.
6. **Any production containment change (`parked` → `active`)** — **still not requested, and now
   affirmatively withdrawn as an ask.** The previous reconciliation left this open pending
   measurement. The measurement is done and points away from it twice: an unpark cannot be bounded
   (`SYNDICATE_MACHINE_MODE` is binary, and `active` also starts the worker and releases delivery
   targets from the forced `none`), and it is not necessary (operator CLI scripts reach the results
   writers in-process without the daemon). Both are evidenced under "Layer 3 is answered" above.
   **What replaces it is smaller and is item 6a.**
6a. **Confirm whether the production `SGO_API_KEY` is active** — reserved decision 4, and the
   smallest operator action that closes the last open question in Milestone 2 condition 3. The key
   available to tooling returns `403 Inactive API key`, verified live on 2026-09-09; whether the
   production secret differs cannot be checked without reading it. **Non-secret success criterion:**
   a single authenticated `GET` against the provider's account/usage endpoint using the production
   value returns `isActive: true` and a tier name. No key material is printed or leaves the machine,
   and nothing is written.

   If it comes back inactive, layer 3 becomes a **paid provider commitment** — reserved decision 3 —
   and this plan will say so rather than routing around it. If it comes back active, the follow-on
   ask is a *bounded* operator-run results backfill under `DB_ENVIRONMENT_OPERATOR_POLICY.md`, and
   **that packet is not written yet and is not requested here**: `ingestLeague` writes offers and
   events broadly rather than results alone, so its blast radius has to be measured before it is
   put in front of anyone. Nothing about 6a authorizes a write.
7. **Review the approval carry-forward Merge Gate integration** (UTV2-1836) — merge authority,
   reserved decision 7. The verifier (`scripts/ops/approval-carry-forward.ts`, #1508) and its
   trusted evidence collector (`scripts/ops/carry-forward-collect.ts`) are both on `main` and
   **nothing calls them**; the workflow hunk that would is presented as a diff and deliberately not
   applied. Blocks nothing.
8. **The `WORK-###` executor-result namespace diff** (UTV2-1688) — reserved decision 7. Two words
   in two byte-identical regex literals, one of them inside a required-check workflow. Blocks
   nothing that is running today; it blocks cutover exit condition 1. Prepared in full above.
9. **A `scope-override/v1` comment** on any future lane that must touch a path outside its own
   `file_scope_lock`. **None is outstanding.**

**Three items left this list by being done since the last reconciliation, and the first of them is
the one that mattered:**

- **The `Deploy` dispatch at `origin/main`** — completed 2026-09-09T00:54:18Z, run `34296962788`,
  shipping `755e52a6c`. It was item 1 on this list for the whole of its existence in one form or
  another. Its stated non-secret success criterion has been met on both halves: production is now
  one bot commit and **zero container files** behind `main`, and a Smart Form submission no longer
  fails — it persisted.
- **The `ALLOWED_CAPPER_EMAILS` shape gap** — closed by being exercised. This plan warned for six
  days that the value was checked non-empty at three layers, shape-validated at none, and would
  first be tested by Griff's own browser. That is exactly what happened, and the value was correct.
  The gap in the *deploy* remains real for any future reshape: nothing still validates the shape,
  and the `smart-form` healthcheck still returns 200 regardless of allow-list contents.
- **Approve #1536** (UTV2-1856) — merged.

Earlier departures, retained because the pattern is the point: the PT1 containment admission
(2026-09-07, route B, landed as UTV2-1851/#1528 — it had blocked *every* lane the mechanical floor
raised to T1, not only UTV2-1842); the `scope-override/v1` on #1521, routed around rather than
granted; the `ALLOWED_CAPPER_EMAILS` reshape; the #1477 decision; the #1501 approval; and the #1499
scope override.

## Learned

- **A milestone closed, and the thing that closed it was a dispatch — not a repair.** For five
  reconciliations this plan named an engineering blocker as the last obstacle to Milestone 1, and
  each time the blocker underneath turned out to be reserved rather than technical. The final
  sequence was: repair merged → deploy dispatched → milestone performed. **The engineering had been
  finished for a day before the milestone was reachable**, which is the strongest available
  statement of the merged-is-not-shipped rule this plan recorded on 2026-09-08. Worth keeping now
  that it has been paid off rather than only warned about.

- **The one prediction this plan repeated most often was correct, and it was correct because it
  named the mechanism rather than the outcome.** For six days it said `ALLOWED_CAPPER_EMAILS` was
  checked non-empty at three layers, shape-validated at none, that the healthcheck returned 200
  regardless of its contents, and that Griff's browser would therefore be its first real test. All
  four were true and the value happened to be right. **The gap is not closed by the value being
  right** — nothing validates the shape today either, so the next reshape carries the identical
  risk with no accumulated protection. A risk that does not fire is not a risk that was wrong.

- **Verifying a milestone means reading the row, not the receipts underneath it.** The Milestone 1
  verification queried the persisted pick, its lifecycle, its promotion history, its participants
  against the real `participants` table, four separate delivery-bearing tables, and the deploy's own
  containment log. Every one of those could have been argued from code and tests that were already
  green — and the 2026-09-08 client-guard defect is proof that green tests coexisted with a form
  that refused. **Enumerate the delivery-bearing tables from the schema** (`information_schema`
  for `pick_id`) rather than from the two you happen to remember; two of the four checked this way
  were not in the plan's own prior list.

- **A monitor that has failed 12,634 consecutive times is not a monitor.** `governance.awaiting-approval-drift`
  reports `failed` every 15 minutes on a static 14,984-row backlog while computing
  `countIncreased: false` in the same payload — it holds the field that would distinguish real
  drift from historical residue and does not use it. This is the "a control that fires on
  everything conveys no information" class, and it is the first instance where the control's own
  output contains its own repair. Also a reminder that the fix is in the classifier: deleting the
  rows to make the monitor green would be destroying audit history to improve a dashboard, and
  production data deletion is reserved besides.

- **Config that is *not* gated is as load-bearing as config that is, and nobody writes it down.**
  `UNIT_TALK_GRADING_CRON_AUTORUN=true` sits at `deploy.yml:540` outside the
  `SYNDICATE_MACHINE_MODE` case statement that parks the ingestor and worker. That single
  placement is why grading has 13,720 successful runs under containment, and it materially changed
  Milestone 2's starting position — but no document said so, and the plan spent five days
  describing containment as though it stopped everything. **When recording what containment parks,
  enumerate what it does not.**

- **Promotion ran, scored, force-promoted past its own minimum, and delivered nothing — and only
  the last of those is guaranteed by containment.** The Milestone 1 pick is `qualified` for
  `best-bets` at score 64.02 against a policy minimum of 70, via a source-based override. Track
  Only made it harmless. The general form is worth holding onto going into Milestone 2: **a guard
  that blocks the consequence does not correct the decision**, and when the guard is removed the
  decision is what remains.

- **A client guard that mirrors a server rule is one rule stored twice, and deleting the server copy
  silently re-arms the client copy.** UTV2-1856 removed the server refusal *"canonical player
  selection requires a canonical event"*; `evaluateSubmissionGuards` kept its mirror of that exact
  rule, citing it by `file:line` in a comment. Every test stayed green — the server tests assert the
  server's new behaviour, the client tests assert the client's old behaviour, and no test compares
  them — so a green `verify`, a complete T1 proof bundle and a merged repair all coexisted with a
  form that refused before issuing a request. **Server-side evidence cannot detect this class at
  all**, because the defect is that the request is never sent. It was found in ~40 seconds of
  Playwright and would not have been found by any amount of reading. The mechanical form of the
  lesson matches UTV2-1688's: where a rule is duplicated for a real reason, something must fail when
  the copies disagree; a `file:line` citation in a comment is documentation of the coupling, not
  enforcement of it.

- **"Demonstrate the path" and "prove the components" are different obligations, and only one of
  them ends a milestone.** The submission repair had unit tests, live-DB tests, mutation tests and
  green CI at every step, and the operator still could not submit. Milestone 1's steps are written
  as operator actions for exactly this reason. Any future claim that a step is repaired needs a run
  of that step, not a receipt from underneath it.

- **A merged repair is not a shipped repair, and this plan wrote the confusion into its own
  headings.** The 2026-09-07 draft said "the submission blocker is closed" in a section whose
  subject was explicitly the *deployed* system. Both halves were individually true — UTV2-1842 was
  merged, and the pilot runs against production — and the sentence connecting them was false. It
  took a `git rev-list --count d3f69b804..origin/main` returning **45** to notice. The generalisable
  rule is narrow and mechanical: **when a claim is about a deployed system, the evidence has to be
  an ancestry or drift measurement against the deployed SHA, never a merge SHA.** The plan already
  applied that rule correctly to #1488 and #1501 (`git merge-base --is-ancestor`); it stopped
  applying it the moment the merges started arriving faster than the reconciliations.

- **The two-lane sequencing argument was right about the risk and wrong about the file.** "The route
  B bootstrap" section below reasoned carefully that the admission change could not land in one
  lane, because copying the deferral onto the manifest lives in `lane-start.ts`, which is T1-floored
  by `tier-c-pattern` — the exact refusal the change exists to lift. UTV2-1851 landed it in **one**
  lane by putting the carry-forward in `createManifest` in `shared.ts`, a T3 file that
  `lane-start.ts` calls. The hazard the section identified was real and had to be closed; the
  ordering constraint it derived was an artifact of assuming where the code had to go. **A tier
  floor is computed from the file list, so the file list is a design variable, not a given** — when
  a floor makes a change unopenable, ask which file the change actually needs before accepting the
  sequencing cost.

- **A leaked lease has now blocked five lane starts, which is what the filing threshold's
  "repeatedly strands lanes" clause is for.** UTV2-1849 merged, truth-closed, manifest `done` on
  `main`, `owner_pid: null` — and its lease refused UTV2-1858 with `lease_conflict`. Reclaim is
  purely TTL-gated, so the only escape is knowing that `ops:lease release --issue <ID> --actor
  <who> --reason <why>` exists. `findLeasesHeldByTerminalLanes` already computes the right
  predicate; the reclaim path consults the clock instead. Fifth occurrence: UTV2-1830, 1835, 1838,
  1840, 1849. It is now the strongest candidate for the governance slot.

- **A failed `lane-start` leaves a branch and worktree the retry then refuses**, and the sanctioned
  cleaner does not model that state. `ops:lane-start` created both before failing the lease check;
  the retry reported *"Branch and worktree already exist but no manifest exists for this issue"*.
  `git worktree remove --force` plus `git branch -D` is the working path. Recorded again because
  it compounds with the lease defect above: one leaked lease costs two failures, not one.

- **A red check can be red for a reason that has nothing to do with the code.** #1521's
  `QA Experience Regression (Advisory)` failed at its *"Post PR comment"* step with a GitHub API
  403 — *"Resource not accessible by integration"* — after the check itself had already concluded
  `NEEDS_REVIEW` (advisory; the apps are not running in CI). The workflow's finding was
  informational and the job failed on a permissions grant, not on a QA result. This belongs to the
  same aggregate-conflation class already recorded three times over — infrastructure failure and
  policy or product state reported as one verdict — and it is a fourth instance rather than a new
  defect. Recorded rather than filed, per the filing threshold.

- **When a lane's only scope violation is a shared registry file, land the registration as its own
  lane instead of asking for an override.** #1521 sat one `scope-override/v1` away from mergeable
  for two days on a single violation: `.lane/lanes/governance.yml is not declared by UTV2-1843`.
  UTV2-1857 registered the same paths byte-identically in its own T3 lane; the resync then dropped
  the file from #1521's diff entirely and `File scope lock` went green with no human artifact and
  no head pinning. The override route costs one Griff round trip *per head move*, and the readiness
  bot moves heads on a schedule. This route costs one lane and is immune to that.

- **A reserved gate's blast radius is itself a measurement, and stating it from the one case that
  surfaced it understates it.** This plan said the PT1 containment admission blocked UTV2-1842 and
  that *"nothing else on the board waits on this"*. The predicate is not the issue — it is the
  mechanical tier floor: PT1 runs at T1, is waivable at no tier, and `classifyMechanicalMinimum`
  raises **any** path under a Tier C prefix to T1. `.github/workflows/` is such a prefix, so the
  CI wiring that Wave 1 step 3 needs is blocked by the same decision. The error was not a wrong
  fact; it was reporting the instance instead of the rule, and it cost nothing to correct only
  because the next lane happened to be `docs/mission/plan.md`, which floors at T3 and could still
  be opened. The general form: when recording what a gate blocks, enumerate it from the gate's own
  predicate, never from the work that happened to hit it.

- **Landing the enforcement before the admission changes what the owner is being asked.** UTV2-1848
  built and merged the closeout gate that a deferred T1 live-DB precondition would need
  (`t1_live_db_precondition` + `G6`), while admitting nothing — 0 of 752 manifests carry the field,
  asserted by a test that reads them all rather than by a claim. The reserved decision is now a
  yes/no on a three-edit diff whose protection already exists on `main`, instead of a decision to
  authorise building one. This is the shape "How a reserved decision is surfaced" in `intent.md`
  asks for, and it is reusable: the half of a reserved change that *tightens* is usually
  unreserved, and landing it first shrinks the reserved half to something reviewable.

- **A test that reads the real corpus finds defects a fixture never will.** The UTV2-1848
  acceptance test walks every `docs/06_status/lanes/*.json` on the branch, and 16 of 752 threw
  `ERR_INVALID_ARG_TYPE` out of `validateManifest` — `isPortableAbsolutePath` (`shared.ts:1884`)
  assumes a string and every closed lane's manifest carries `worktree_path: null`. Pre-existing,
  unrelated to the new field, and invisible to every hand-written manifest fixture in the suite.
  Counted and skipped explicitly with a non-vacuity assertion rather than swallowed, and recorded
  here rather than filed, per the filing threshold.

- **"lane closed, sync file removed" is still false.** `.ops/sync/UTV2-1848.yml` is tracked on
  `main` after a closeout commit whose message says it was removed. This is now confirmed on every
  lane that has checked it; the string is a template, not an observation.

- **Clearing the last reserved item on a path does not mean the path is clear — it means the next
  blocker becomes visible.** This plan said for five days that a single `Deploy` dispatch was all
  that stood between `main` and a runnable Milestone 1 pilot. The dispatch happened on 2026-09-06
  and the pilot still cannot complete, because step 4 fails on the event-existence gate. The
  statement was not a lie; it was a claim about *what was known to be in the way*, phrased as a
  claim about what was in the way. Those are different, and the difference only shows up when the
  named item is removed. The honest form is "this is the next blocker", never "this is the only
  one" — a plan can enumerate what it has measured and cannot enumerate what it has not.

- **A reserved action can be blocked by an ordinary repository defect, and that is not a reason to
  escalate.** The first `Deploy` dispatch of 2026-09-06 failed inside the deploy workflow's own
  `verify` job. Nothing about the reservation was the problem. UTV2-1841 diagnosed and repaired
  `.github/workflows/deploy.yml` through a normal governed lane, merged as #1520, and the deploy at
  that very commit succeeded nineteen seconds later. The generalisation for the decision-packet
  format: a packet that enumerates the risks of *the change* can still be blind to the risks of
  *the mechanism that applies the change*, and this one was — it was watching the allow-list value
  exclusively.

- **A RED readiness verdict is not a statement that the product is broken when two of its blocking
  dimensions measure flags that policy sets to false.** `ingestor_health` and `worker_outbox_health`
  fail because `SYNDICATE_MACHINE_MODE=parked` disables their autorun, which is containment working
  as designed. `deploy_sha_alignment` fails on a 1-commit SHA distance with zero container-code
  files differing. `dead_letter_count` fails on 1954 rows of which 1953 are governance holds the
  ledger's own semantics exclude. **Readiness cannot reach GREEN while containment holds** — which
  means the verdict is currently measuring the gap between the contained system and a fully
  autonomous one, not the gap between the system and working. That is worth knowing before anyone
  reads RED as a reason to unpark something. It is not one.

- **Non-required checks are not interchangeable, and treating them as a class is how a real scope
  violation gets waved through.** #1523 merged with two red non-required checks, and #1521 is being
  held with one. The difference is not the checks' status but what they found: #1523's `Return
  review packet` named `.gitkeep` and `evidence.json` — the lane's own required artifacts, inside
  its own proof directory, one created by `ops:lane-start` itself and the other mandatory for ERV —
  which is the recorded `pr-review-packet.ts:487-491` defect. #1521's `File scope lock` named three
  paths genuinely outside its pinned lock. The first is a defective check reporting on correct
  work; the second is a correct check reporting on a real scope question. "Non-required" is a
  statement about merge mechanics, never about whether the finding is real, and each red has to be
  read before it can be classified.

- **A crash can be the only thing preventing a data-loss bug, and repairing it alone is a
  regression.** `ops:lane-finalize` halted on every static-proof lane because `readOptionalFile`
  threw ENOENT on a file `ops:proof-generate` never writes. That crash was thrown while evaluating
  a *function argument*, so it fired before the writer ran — and the writer, always invoked with
  `--force`, would otherwise have put a Markdown bundle over every entry in
  `expected_proof_paths`, including the 27 T2-eligible manifests that declare `evidence.json` or
  `model-routing.json` there. The generalisation: before fixing a fail-closed error, establish what
  currently *cannot happen because of it*. UTV2-1838 landed the overwrite guard first and the
  ENOENT repair second, and the inversion test asserts the sidecar's bytes rather than an exit code.

- **A vacuous `.every()` is a fail-open, and enumerating the inputs is what finds it.** The first
  draft of the carry-forward Merge Gate integration read `(t1Errors.codes || []).every(c => c ===
  'stale_head')`. On an absent list that is `[].every(...)` — true — so `onlyStaleness` would have
  been true for *every* early-return path, including **no verdict at all** and **unauthorized
  author**, and the gate would have carried an approval forward onto PRs that were never approved.
  It was found by enumerating the seven verdict shapes and reading what each returns, not by
  reading the predicate. The repair attaches a code on every return path and throws on a
  length mismatch, so a desynchronised result cannot be produced rather than merely being unlikely.
  The measured integration effects belong to the reserved packet
  (`docs/05_operations/CARRY_FORWARD_MERGE_GATE_INTEGRATION.md`), and three of them are the real
  decision: the Merge Gate job has no Node/pnpm toolchain today, so enabling the collector makes a
  **required** check depend on a `pnpm install`; `require('child_process')` collides with
  `workflow-hardening.test.ts:191`; and `workflow-hardening.test.ts:1150` forbids the gate job from
  fetching anything keyed on `pull_request.head.sha`, which is exactly what content equivalence
  needs to read.

- **A `file_scope_lock` is pinned at lane-start, so the scope decision is made before the work is
  understood.** UTV2-1838's declared scope covers three of the five files its own issue names;
  `truth-check-lib.ts` and `lease-registry.ts` are outside it and a lock cannot be widened by an
  agent. Both remaining items are recorded above under "Closeout repeatability" rather than
  smuggled in through an override. This is the routine cost of the lock, not a defect in it — but
  it argues for declaring scope from the issue's own file list at lane-start, which is what
  `ops:scope-suggest` exists for.

- **The orchestrator was returning control at every seam, and every one of those seams was inside
  the mission rather than at its edge.** Ratified by PM on 2026-09-05: waiting on CI, finishing a
  lane or a PR, having a status worth reporting, and receiving a question or correction are all
  *inside* a run, not the end of one. A reserved gate blocks only the work that depends on it. The
  measurable cost of getting this wrong is not a wasted prompt — it is that the independent work
  which never depended on the gate does not get done while the gate is open. This plan is the
  evidence: on 2026-09-05 exactly one item required Griff on the Milestone 1 path, and two live
  production security defects with green `verify` (#1493, #1494) sat unstaffed behind it. The
  authoritative statement is `intent.md` § "Stop conditions"; `CLAUDE.md` carries only a pointer.
  Recorded here, not filed, per the filing threshold.

- **A correction round is where the next defect gets introduced.** Every one of the six adversarial
  review rounds on UTV2-1811's proof bundle closed a defect and introduced at least one new one of
  the same class — a claim about the work that the work did not support. Three were BLOCKING and
  self-inflicted: "never more restrictive" (false in both directions; 26 restrictive divergences in
  a grid of 1314), "cannot let an undefined RPC ship" (the exact inverse — over-marking is the
  parity check's false-negative mode), and a cited "parity fake" that does not exist. **None of the
  defects were ever in the engineering.** The implementation was correct from the first commit and
  never changed; five commits and six rounds were spent making the bundle's *description* of it
  true. The generalization, already filed as a memory: proof values must be generated from the
  artifact, not written about it from recollection — including directional and methodology claims
  wrapped around otherwise correct facts.

- **The OS re-derives diagnoses it has already written down, and that is its dominant hidden cost.**
  On 2026-09-03 the closeout strand was diagnosed from scratch as "a lane can run end to end with
  its Linear state untouched," and the head-pinning tax was measured from scratch as "automated
  ledger commits invalidate every open lane's approval artifacts." **Both were already filed, and
  better.** `UTV2-1730` names the first with reference case UTV2-1451 and classifies it as the
  UTV2-1724 defect class on another limb. `UTV2-1818` names the second with a measured reproducer:
  PR #1476 approved at an exact head, `19a143a27` pushed by the readiness bot fifty seconds later,
  strict freshness making it BEHIND, and the sanctioned sync then moving the proof anchor and
  forcing a *second* head change. Five of six "new" improvements proposed that day already existed
  as issues — `UTV2-1818`, `UTV2-1730`, `UTV2-1529`, `UTV2-1675`, `UTV2-1767`/`UTV2-1769`. The
  backlog is not a record of what is broken; it is a record of what has already been understood and
  will not be staffed, and re-reading it costs less than re-deriving it.

- **An unbounded diagnosis rate against a capped repair rate accumulates monotonically.** 69 issues
  carry `governance-critical`; 39 are open and unstarted. That is not a failure of any individual
  fix — it is the arithmetic of a system that produces correct diagnoses far faster than one lane at
  a time can consume them, which is why the filing threshold and the empty-slot rule in `intent.md`
  are bounds rather than features. Disposition of the existing backlog is a later classified pass,
  never a mass close.

- **A fail-closed control that allocates a resource before classifying the command can deny
  everything, including its own recovery.** `.claude/hooks/pre-proof-validator.sh:21` calls `mktemp`
  on *every* Bash invocation, before it inspects whether the command is even a commit, and exits 2
  when allocation fails. A full `/tmp` therefore denied every Bash call in every session — including
  the `rm` that would clear it — while the hook's actual validation (lines 367-374) only ever runs
  on staged `docs/06_status/proof/*` paths. Cost: an entire session segment, more than any gate
  cost that day. **Repair candidate:** command classification must happen *before* any
  temp-workspace requirement, so ordinary diagnostics and recovery commands can never be globally
  denied by ENOSPC, while actual proof and commit mutations stay fail-closed. The detection step
  writes to stdout and can be captured in a shell variable, so no temp file is needed to decide
  whether the command is in scope. This is an instance of the same aggregate-conflation class as
  `UTV2-1730`/`UTV2-1724` — infrastructure failure and policy refusal reported as one verdict —
  and is recorded here rather than filed, per the filing threshold.

- **Head-pinned governance artifacts should be requested last, not first.** Every commit that moves
  the head invalidates `scope-override/v1`, `t1-approved`, `pm-verdict/v1` and `EXECUTOR_RESULT`
  alike. The reconciliation and the resync on this lane were therefore both landed *before* the
  override was requested, so a single human action binds a head that will not move again. Asking
  first and reconciling after costs the owner one round trip per reconciliation.

- **The bottleneck was never capability.** Every open PR sat green on real safety. Establishing that
  took reading branch protection and a handful of check-run outputs — a question nobody had asked
  mechanically.
- **Opening PRs outside the lane system does not route around the gate; it makes the gate
  unevaluable.** Seven PRs are stuck on "cannot resolve authoritative tier" — a self-inflicted
  block, not evidence that the gate is wrong.
- **A control that fires on everything conveys no information** — but replacing it is an
  architecture decision with a named owner, and building the replacement first does not make the
  decision.
- **Detection is not prevention.** `Direct Main Push Guard` did exactly what it was built to do and
  the push still landed, because `enforce_admins: false`. A red guard run is an incident.
- **A test that drives a function directly cannot see whether the function was called.** Every
  Command Center auth test called `middleware()` and passed; the matcher excluded every dotted path,
  so Next never invoked it and `/picks/abc.def` returned 200 with authentication required. Found by
  measuring a running server, not by reading tests.
- **Stale runtime claims are worse than absent ones.** "Worker DOWN" had been true-shaped for four
  months and was load-bearing in the readiness contract. One deploy log settled it.
- **Concurrent terminals on one checkout produce exactly the drift the lane system prevents.** Three
  sessions, one direct-`main` push, two of them iterating the same branches without knowing it.
