# Mission Plan — live

**Owner:** Claude. Rewritten as reality changes. Not a log, not a backlog, not Linear in Markdown.
**Last reconciled against live truth:** 2026-09-16, against `main` `d2e447893`
**Archives, read on demand — never at session start:**
[`plan-lessons.md`](plan-lessons.md) (operating lessons) ·
[`plan-history-2026-09.md`](plan-history-2026-09.md) (chronological narrative through 2026-09-14)

This file is startup context. It answers only what a session needs before it can act, and it is
rebuilt from live GitHub, runtime and database evidence rather than edited forward from its previous
text. Anything that is history rather than state belongs in an archive above.

---

## 1. Current truth

Measured 2026-09-16 against `origin/main`, the GitHub API and production `zfzdnfwdarxucxtaojxm`.

| Fact | Value |
|---|---|
| `main` | `d2e447893` (readiness-ledger refresh, `[skip ci]`) |
| Deployed release | `a45e9cd11` — `Deploy` run `34858627673`, 2026-09-14T15:12Z |
| Drift `deployed..main` | **43 commits, 28 container files, 0 migrations** |
| Governed pick cohort (`metadata ? 'distributionMode'`) | **4**, all `track-only`, all honest `confidence-delta` provenance |
| Settlements / outbox rows for those 4 picks | **0 / 0** |
| Newest `distribution_outbox` row repo-wide | 2026-07-30 20:04:41 — unchanged |
| Grading in production | **alive** — 13,964 succeeded runs, latest 2026-09-16T12:32:16Z |
| Newest `events` / `game_results` | **2026-06-30** — the results supply is still empty |
| Readiness ledger verdict | **RED**, observability `degraded` |
| Open PRs | **13** — 7 tier-resolved, 6 inadmissible |
| Active lanes | UTV2-1919 (`runtime`), UTV2-1920 (`governance`), UTV2-1921 (`governance`, this one) |

**Milestone 1 is complete.** Performed by Griff end to end against the deployed system on
2026-09-09, verified by governed read-only production observation, containment intact throughout.
The full evidence narrative is in
[`plan-history-2026-09.md`](plan-history-2026-09.md#milestone-1--the-completion-record); it is not
repeated here because it is settled.

**Milestone 2 is the active milestone** — making internal submission, grading and settlement
*routine* rather than proven once. Its six conditions are in `intent.md`; where they stand is §3.

---

## 2. Production position

**`main` cannot currently produce a deployable build, and that is the single most important fact on
this page.**

`packages/contracts/src/picks.ts` contains an invalid UTF-8 byte on `main` (verified:
`git show origin/main:packages/contracts/src/picks.ts | iconv -f UTF-8 -t UTF-8` fails). The
`Deploy` dispatch on `f47a35859` (run `35075808951`, 2026-09-16T08:48Z) **failed** at
`build-nextjs (command-center)` with:

```
apps/command-center build: 0: Failed to read source code from /repo/packages/contracts/src/picks.ts
Build failed because of webpack errors
```

Since UTV2-1918 the Command Center is a member of the `build-nextjs` matrix (`deploy.yml:279-281`),
so a Command Center build failure fails the **whole** deploy — even though the Command Center
service itself is default-off behind a `command-center` compose profile and
`UNIT_TALK_COMMAND_CENTER_ENABLED`. The repair is **#1588 / UTV2-1920**, whose head `a73be481c` is
verified valid UTF-8. Nothing else on the board substitutes for it.

Consequence: the 28 container files of drift — including the spread-grading repair, capper
attribution, the parlay ticket contract, the multi-leg slip, operator settlement and the per-capper
Track Only statistics — are **merged and none is running**. `deploy_sha_alignment` is measuring a
genuinely stale product, not bookkeeping.

**Readiness dimensions**, from `docs/06_status/readiness/readiness-score.json`:

| Dimension | Blocking | Status | What it means |
|---|---|---|---|
| `deploy_sha_alignment` | yes | fail | real — 43 commits, 28 container files behind |
| `ingestor_health` | yes | fail | **containment** — `SYNDICATE_MACHINE_MODE=parked` sets `AUTORUN=false` |
| `worker_outbox_health` | yes | fail | **containment** — same mechanism; last `worker.heartbeat` 2026-08-17 |
| `dead_letter_count` | yes | unknown | partial read yields `unknown` rather than a quiet pass |
| `db_tripwires` | yes | unknown | the observer itself is red, so tripwire state is unproven |

**Readiness cannot reach GREEN while containment holds**, because two blocking dimensions measure
precisely the flags containment sets to `false`. The six-dimension T1 contract measurement is a
separate and stricter instrument — see §8.

---

## 3. Active work

**Recently merged and awaiting deployment** (all on `main`, none running):

| PR | What |
|---|---|
| #1587 | internal-only Command Center deployment candidate, default-off |
| #1586 | operator grading attestation on every Command Center settlement |
| #1585 | per-capper Track Only statistics from the resolved settlement |
| #1583, #1584 | multi-leg slip construction, reorder, review; refusal rendered at the offending leg |
| #1582 | parlay ticket contract — multi-leg pricing, validation, outcome, identity |
| #1581 | capper attribution from `picks.capper_id`, never from `pick.source` |
| #1580 | grade game spreads off an attested signed margin, and refuse anything else |
| #1513 | Command Center management token hardening — **merged 2026-09-16**, no longer an ask |

**Milestone 2, measured against `intent.md`'s six conditions:**

| # | Condition | State |
|---|---|---|
| 1 | Repeatable submission without per-submission engineering | **Advancing.** 4 picks across 4 days by the intended operator; the multi-leg path is merged but undeployed. |
| 2 | Canonical identity and truthful provenance on every pick | **Holds for all 4.** Two moneylines and two spreads, all honest `confidence-delta`, `hasRealEdge: false`. |
| 3 | Grading and settlement on schedule against real results | **Blocked at the results supply.** Grading is alive; no result row after 2026-06-30 exists to grade against. |
| 4 | Statistics computed from persisted history | **Merged, undeployed.** #1585 computes per-capper Track Only statistics over the governed cohort. |
| 5 | Operator observes through a governed internal surface | **Merged, undeployed, and blocked by §2.** #1587 is the candidate; the deploy that would ship it is the one failing. |
| 6 | None of it achieved by activating member-facing delivery | **Holds.** 0 outbox rows for all 4 picks; newest outbox row repo-wide is 2026-07-30. |

**The governed cohort predicate is `metadata ? 'distributionMode'`, and getting it wrong is silent.**
~93% of `picks` are CI fixtures predating staging isolation; `v_governed_pick_performance` filters
`source = 'board-construction'` and structurally cannot contain an operator submission; and
`capper_id = 'griff843' AND source = 'smart-form'` returns 13 rows, 12 of them 2026-05-29 proof
fixtures with 6 marked `settled`. Identify genuine submissions *positively*.

---

## 4. Blockers

| Blocker | Blocks | Owner |
|---|---|---|
| **Invalid UTF-8 in `packages/contracts/src/picks.ts` on `main`** | every deploy, therefore every merged-but-unshipped repair and Milestone 2 conditions 4 and 5 | #1588 — needs Griff's T1 verdict |
| **Results supply: no `events`/`game_results` after 2026-06-30** | Milestone 2 condition 3; the entire settlement chain | reserved decision 4 (SGO key) — see §5 |
| **Six PRs carry no resolvable tier** | #1429, #1491, #1492, #1495, #1496, #1498 — themselves only | readmission through `ops:lane-start`, not a gate change |
| **`migration` lane type unavailable** | `forbidden_combination` against #1484's `data-canonical` lane; blocks UTV2-1871 and the Smart Form e2e gate enablement | approving #1484 |
| **Smart Form e2e gate defaults off** | browser-level coverage in CI. `grep -rn UNIT_TALK_SMART_FORM_E2E .github/` returns nothing, so enabling it is a `.github/workflows` edit, admitted only by `migration` (blocked) or `runtime` | follows #1484 |
| **`P0 Protocol` is blind to `WORK-###`** | tracker-independence exit condition 1 — a required check auto-passes such a branch in ~10s | reserved (merge authority) |

**The contained Chiefs E2E path is built and is not a blocker.**
`apps/smart-form/e2e/phase-one.spec.ts` drives a manual NFL `Chiefs @ Bills` matchup through the
deployed-shape form and asserts the persisted pick carries `capper: griff843`,
`distributionMode: 'track-only'`, canonical `participantResolution` for both teams and
`eventId: null` — the honest coverage-gap shape. Six spec files now exist (`auth-gate`,
`multi-leg-slip`, `offline-offer-slip`, `phase-one`, `real-reference`, `smart-form-submission`).
They run locally; only the CI gate is off.

---

## 5. Decisions required from Griff

Ordered by how much each unblocks. Everything else on the board is independent of all of them.

| # | Decision | Reserved under | Blocks |
|---|---|---|---|
| 1 | **Post `pm-verdict/v1` APPROVED on #1588** (UTV2-1920, T1) — the UTF-8 repair | merge authority (7) | **Every deploy.** `t1-approved` is already applied; `Merge Gate` reads *"T1 requires a valid pm-verdict/v1 comment"*. This is the whole of §2. |
| 2 | **Dispatch `Deploy`** once #1588 is on `main` | decision 8 | 28 container files of merged repairs, and Milestone 2 conditions 4 and 5. 0 migrations, so no DDL prerequisite. |
| 3 | **Verdict on #1589** (UTV2-1919, T1) — evidence-plane settlement correction | merge authority | #1589 only. Same posture as #1588: `t1-approved` applied, `pm-verdict/v1` missing. |
| 4 | **Confirm whether the production `SGO_API_KEY` is active** | secrets (4) | The results supply, and with it Milestone 2 condition 3. Prepared in full as `RESULTS_BACKFILL_AUTHORIZATION_PACKET.md`. The key available to tooling returned `403 Inactive API key` when last probed 2026-09-09; whether the production secret differs cannot be checked without reading it. **Non-secret success criterion:** one authenticated `GET` against the provider's account/usage endpoint returns `isActive: true` and a tier name. If it comes back inactive this becomes a paid-provider commitment (decision 3) — there is **no alternative exit in code**, since the operator-attestation route was deleted under #1567's CHANGES_REQUIRED verdict and `operator` provenance is refused by the grading trust allow-list. |
| 5 | **Approve #1484** (canonical reference bootstrap, `verify` green) | merge authority | The single action that reopens the `migration` lane type, and with it UTV2-1871 and the e2e-gate enablement. |
| 6 | **Approve #1570** (UTV2-1892, T1) — `WORK-###` in the trusted Merge Gate parser | merge authority (7) | The tracker workstream only, and #1556 behind it. Must not be allowed to block production. |
| 7 | **Final verdict on #1556** — after #1570 lands and #1556 resyncs once | merge authority | The tracker-independence cutover only. Every artifact on it is head-bound, so it is deliberately stationary. |
| 8 | **#1491 / #1492 architecture review** — merge and agent authority | merge authority | Those two PRs only. Explicitly not the mission. |
| 9 | **#1451** — production DDL, `verify` red | production DDL (1) | #1451 only. |
| 10 | **Direct-`main` prevention control** — `enforce_admins`, a ruleset, or a `pre-push` hook | branch protection | Nothing. The prohibition is already in force; what is reserved is mechanical enforcement. |

**Affirmatively not asked for.** No containment change. No clearing of the 35 canary outbox rows.
Both are reserved, and both would be production writes made to improve a number rather than to fix a
defect.

---

## 6. Recommended / executable next wave

**Under existing authority, nothing reserved.** A reserved gate blocks only the work that depends on
it; everything here is independent of §5.

1. **Keep the plan and its archives honest.** This lane (UTV2-1921). Startup context must stay
   loadable or every later session pays for it.
2. **Persist the grading skip histogram.** `grading-service.ts` records only `{picksGraded, failed}`,
   discarding the per-pick `outcome: 'skipped'` + `reason` it already computes — so a pass that
   examined 15,000 picks and graded none is byte-identical to one that examined zero. **Owned by
   UTV2-1605**, PM-ratified and routed to Codex. Not unowned; do not re-file.
3. **Repair `governance.awaiting-approval-drift`'s classification.** Built and proven (7/7 behaviour
   drill), filed as **UTV2-1871**, blocked only on the `migration` lane type (decision 5). It has now
   failed **13,342** consecutive times while computing `countIncreased: false` in its own payload —
   a monitor that has been red for months cannot signal the drift it exists to catch. The repair
   belongs in the classification, never in the data.
4. **Submit again through the deployed form**, in market shapes not yet exercised — a player prop or
   a total. Condition 1 is a claim about repeatability and only repetition tests it. **Operator
   action**, and worth doing only after the deploy in §5 item 2, since the deployed image predates
   the spread-grading and multi-leg work.
5. **Re-home the six inadmissible PRs** through `ops:lane-start --readmit-existing-branch` under
   canonical issues. Renaming an open PR's head branch closes it and it will not reopen, so
   readmission means a replacement PR carrying the same diff.

**Not executable, and why:** anything needing a `migration` lane (blocked by #1484); the e2e gate
(same); the results backfill (decision 4); Command Center observation (needs the deploy).

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
  member-facing delivery are all parked.
- **Containment is binary.** `deploy.yml` admits `active | parked | exit 1` only. `active`
  simultaneously sets `_worker_autorun=true`, sets `SYNDICATE_MACHINE_ENABLED=true`, and releases
  `_enabled_targets` from the forced `none` — and the readiness assertion that delivery is off runs
  **only in parked mode**. So a request to unpark ingestion *is* a request to activate delivery.
  There is no bounded unpark.
- **Grading is deliberately not contained.** `deploy.yml:599` sets
  `UNIT_TALK_GRADING_CRON_AUTORUN=true` unconditionally, outside the `SYNDICATE_MACHINE_MODE` case
  statement. This is why grading runs while the ingestor and worker do not.
- **Non-delivery is enforced, not merely absent.** `isTrackOnlyPickMetadata` gates **eight**
  independent modules on `main`, verified 2026-09-16: `controllers/submit-pick-controller.ts:85-96`
  (the submit-time pin), `distribution-service.ts:243` (the enqueue chokepoint →
  `TrackOnlyDistributionError`), `run-audit-service.ts:70` (the atomic-RPC audit),
  `controllers/requeue-controller.ts:25`, `controllers/retry-delivery-controller.ts:42`,
  `recap-service.ts:203`, `routes/health.ts:104`, and — added by the operator-settlement work —
  `settlement-service.ts:333`. UTV2-1672 mutation-tested the original set. As defence in depth,
  `best-bets`, `trader-insights` and `exclusive-insights` are all `killed = true` in
  `delivery_kill_switch` (verified in production 2026-09-16).
- **Member-delivery activation is separately reserved** and is explicitly not part of Milestone 2.
- **Standing prohibition:** ordinary direct-`main` bypass. All planned work lands via PR on green CI.
  One incident remains open and unrecorded — the 2026-09-02 push `717b46971`; `Direct Main Push
  Guard` fired red (run `33683588651`) and could not prevent it, because `enforce_admins: false`
  structurally exempts an admin credential. Prevention is decision 10.

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
| The four-pick production acceptance | `docs/05_operations/PRODUCTION_ACCEPTANCE_2026-09-14.md` |
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

- **A merged repair is not a running repair, and this page has reported the confusion twice.**
  `main` establishes integrated code; only a successful `Deploy` run establishes what is executing.
  State which boundary a claim holds at: memory → staging DB → browser → production.
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
- **A control that fires on everything conveys no information.** 13,342 consecutive failures of
  `governance.awaiting-approval-drift`, with `countIncreased: false` in its own payload.
- **Do not choose a lane type to evade a concurrency rule.** That is an operating-model change
  reserved to PM. It has been declined once already and should stay declined.
