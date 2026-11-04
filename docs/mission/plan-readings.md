# Mission Plan — dated readings

**Owner:** Claude. Moved unchanged from `plan.md` §1-3 under WORK-2026102305 so the plan imported at every session start carries direction, holds and decisions, not instants.
Every figure below is a reading taken at an instant (mostly 2026-10-15). Re-measure before relying on it, and mark anything you could not verify **UNKNOWN**. Live evidence overrides this page. Section numbers match `plan.md`.

## 1. Current truth

| Fact | Reading (2026-10-15 unless dated) |
|---|---|
| `origin/main` | `4a88bcb49` (readiness-ledger bot commit; re-fetch before citing) |
| Deployed release | `2be2aec81` — `Deploy` run `38673683471`, 2026-10-15, success (Griff authorized the dispatch and approved the `canary` gate; rollback tag `ed89569df`). Carries #1745, #1754 (grading read fix), #1755 (WNBA Smart Form) and #1757. Confirmed mode `human-capper`: ingestor autorun and scheduling off, worker on, one enabled target (`official-picks`), `killSwitchEngaged: true`. |
| Runtime drift `deployed..main` | Re-measure with `git diff --name-only 2be2aec81..origin/main` (expected: lane, proof and ledger files only). |
| Containment variables | `UNIT_TALK_HUMAN_CAPPER_DELIVERY_ENABLED=true`, `UNIT_TALK_HUMAN_CAPPER_DELIVERY_ALLOWLIST=griff843`, `UNIT_TALK_COMMAND_CENTER_ENABLED=true`. No `SYNDICATE_MACHINE_MODE` variable exists. |
| Kill switches | `official-picks`, `best-bets`, `trader-insights`, `exclusive-insights` all `killed = true`. |
| Governed pick cohort (`metadata ? 'distributionMode'`) | **17** picks (14 non-voided; reading ~13:10Z), all submitted by `griff843`; 11 `track-only`. Voided includes `22ebe8ea` (a WNBA pick submitted as `delivery-eligible` by mistake; voided with Griff's authorization via `transition_pick_lifecycle`; its `pending` outbox row was not verified as skipped by the worker). |
| Cohort settlement records | 9 `operator`-source settled picks (4 wins, 5 losses, net -0.66u) after three manual settlements on 2026-10-15 (see §3). The table's 37,502 total is overwhelmingly CI fixtures. |
| Delivery in the last 14 days | 1 outbox row (`706b136b`, `official-picks`, `dead_letter`, `stale_pending_operator_review`), 0 receipts. |
| Participants | MLB 981, NHL 350, NBA 284, **NCAAF 266**, **WNBA 15**, NFL 32 (total 1,928). **No NCAAB.** |
| `public.sports` | NBA, NFL, MLB, NHL, NCAAB, NCAAF, WNBA, Soccer, MMA, Tennis. |
| Members | `member_tiers` has 0 rows. |
| SGO / ingestion | Parked. Newest `ingestor.cycle` 2026-06-30 (failed); newest `game_results` 2026-06-30; no events in the last 14 days (newest 2026-09-28). |
| Runtime heartbeats | `worker.heartbeat` and `grading.cron.heartbeat` succeeded 2026-10-13. `governance.awaiting-approval-drift` last run **failed** (10-13 12:45Z). |
| Readiness ledger | **RED**, generated 2026-10-13T00:23Z — *before* the latest deploy; `deploy_sha_alignment` is therefore stale. Blocking failures: `deploy_sha_alignment` (stale), `ingestor_health` and `grading_health` (SGO parked), `db_tripwires`. `worker_outbox_health` and `dead_letter_count` pass. |
| Open PRs | #1739 (Codex, T2, delivery-ui path admission), #1738 (Claude, T1, constitution-matrix annotation), #1736 (website logo), this lane's PR, and the frozen or inadmissible #1556, #1505, #1498, #1495, #1492, #1491, #1451, #1429. |
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
- **WNBA is live and accepted.** Migration `20261010170100_wnba_participant_catalog.sql` was applied to
  production on 2026-10-15 02:45Z with Griff's authorization (WNBA sport 1, league 1, 15 participants;
  non-WNBA participant fingerprint unchanged). #1755 (Smart Form team sport) merged at `af3df8feb` and
  shipped in deploy `2be2aec81`. Acceptance: pick `803a541b` (Atlanta Dream -130 ML, 3.0u) is
  `track-only`, delivery refused `track-only-requested`, canonical participants, `eventId` null,
  0 outbox, 0 receipts, 0 intents. An earlier WNBA pick `22ebe8ea` was mistakenly submitted
  `delivery-eligible` (held by the kill switch, 0 receipts) and was voided at Griff's direction.
- **NCAAF acceptance passed (2026-10-15).** Pick `8968f86c` (NCAAF total U 70.5, 2.0u): `track-only`,
  refused `track-only-requested`, canonical participants, `eventId` null, 0 outbox/receipts/intents;
  Griff confirmed it renders in Command Center.
- **Manual settlement works through the Command Center.** On 2026-10-15 Griff settled three picks
  through a locally run Command Center (reading production, no public URL exists): `2d462c4f` loss,
  `3ba77527` loss, `92789b58` win. All `operator` source, picks remain `validated`/`track-only`, no new
  outbox rows. **Finding:** those rows record `settled_by = command-center:dev-bypass` (the local
  fail_open bypass), not `griff843`. Griff accepted that attribution for now (§7 #2): the pilot data is test data to
  be cleared before production, and a logged-in settlement test follows later.
- **`706b136b`** is a `delivery-eligible` pick, `queued`, whose only outbox row is a `dead_letter`.
  It is held behind the kill switch. Do not requeue or alter it.

---

## 3. Evidence batch — working pilot measurement

This is **not** a readiness threshold, **not** an automatic declaration of success and **not** a cap
on picks collected. Griff decides whether the evidence satisfies him. The formal bar remains the T1
contract.

| Measure | Working target | Reading 2026-10-15 |
|---|---|---|
| Genuine successful submissions | 25 | 17 governed picks, 14 non-voided, 11 `track-only`, across MLB, NCAAF, NFL, NHL, WNBA. Genuine/non-fixture review not yet recorded per pick: **UNKNOWN** whether all 14 count. |
| Distinct authorized identities | ≥ 2 | **1** (`griff843`). A second identity needs allow-list and capper onboarding — Griff's gate. |
| Independently verified settled picks, covering relevant results and markets | 10 | 9 operator-settled picks. Results for the three 2026-10-15 settlements were looked up from public reports (Falcons 45-24 Saints; Kraken 6-3 Red Wings; Yankees 2-1 Red Sox). "Independently verified" is otherwise **UNKNOWN**. |
| Persisted-to-surface and settlement reconciliation | 100% | Not yet measured as a ratio. |
| Unauthorized deliveries | 0 | 0 in the last 14 days; the dead-lettered `706b136b` row never posted. |
| Unresolved critical identity or data-truth defects | none | None blocking. The `dev-bypass` settlement attribution was accepted by Griff 2026-10-15; `dfcd9486` is unsettled and waived. NCAAB participants absent (§6.C). |

Per-pick measurement is a read-only job over the governed cohort; build it before the next report so
the readings above stop being UNKNOWN. It must not use the `v_governed_pick_performance` view, which
filters `source = 'board-construction'` and cannot contain an operator submission.

---

## 11. Production session rotation reading — 2026-11-04

Taken by Production Claude at about 13:40–14:10Z on 2026-11-04 for a controlled session rotation (WORK-2026110401). Sources are named per row. Re-measure before relying on any figure.

### 11.1 Mission and commercial objective

- The direction is unchanged from `plan.md` §0: quantity and truthful reconciliation of real **Track Only** lifecycles, with zero member delivery.
- The next bounded acceptance objective is the single **private delivery-to-recap canary** (`intent.md` § "Bounded exception", Griff 2026-10-30).
  - One allow-listed human capper's `delivery-eligible` pick goes to a staff-only destination.
  - It is settled with evidence, recapped there, and reconciled in that capper's statistics.
  - Broad member delivery stays disabled.
  - Every production mutation for the canary needs Griff's authorization of **one consolidated final packet**.

### 11.2 Shipped versus deployed

| Fact | Reading | Source |
|---|---|---|
| `origin/main` | `e342655bf` (WORK-2026110303 closeout) | `git fetch; git log -1 origin/main` |
| Deployed release | `913235ce7`, from `Deploy` run `40727467544`, 2026-10-28T16:35Z, `workflow_dispatch`, success | `gh run list --workflow deploy.yml` |
| Drift | 83 commits on `main` since the deployed SHA, 31 of them non-lane, non-ledger | `git rev-list --count 913235ce7..origin/main` |
| Merged, not deployed (product-relevant) | #1811 (canary audiences excluded from member readers), #1816 (worker fails closed when the kill switch is unwired), #1817 (reaper keeps settled picks), #1818 (member `/help` and `/trial-status` copy), #1819 (staff-canary label in operator detail), #1812 / #1800 / #1808 (Command Center results and settlement), #1822 / #1824 (participant artwork binding, NHL headshot host), #1828 (Command Center date range) | `gh pr list --state merged --search "merged:>=2026-10-27"` |
| Containment mode of the deployed release | **UNKNOWN** this reading: the run log's `syndicate_machine_mode.validated` line was not retrievable. The last reading was `human-capper` (§1) | `gh run view 40727467544 --log` |

A merged repair is not a running repair. Everything above "merged, not deployed" is staging-proven at most until Griff dispatches a deployment.

### 11.3 Production acceptance versus staging-only proof

| Item | Production (read-only, `zfzdnfwdarxucxtaojxm`, ~13:42Z) | Staging only |
|---|---|---|
| Governed cohort (`metadata ? 'distributionMode'`) | 4 picks, all `track-only`, all status `validated`, one capper `kingro623`, created 10-27 → 10-31. Each has one `operator`-source settlement (4 wins) | — |
| Delivery | 0 outbox rows in 14 days; 3,734 receipts in total (historical); 32 `processing` outbox rows (the stranded canary rows, held) | Human-capper delivery path proven live on staging by #1826 |
| Kill switches | `official-picks`, `best-bets`, `trader-insights`, `exclusive-insights` all `killed=true`. No `human-capper-recaps` row exists, and `isKilled()` fails closed for a missing row | — |
| Runtime | `worker.heartbeat` 13:44Z and `grading.cron.heartbeat` 13:39Z today | — |
| Ingestion / grading data | SGO parked. Newest `ingestor.cycle` 2026-06-30, newest `game_results` 2026-06-30, newest `events` 2026-09-28 | Fixture/staging proofs only |
| Members | `member_tiers` has 9 rows | — |

Settled Track Only picks keep `status = validated` **by design**. `validated -> settled` is not a legal lifecycle edge for a Track Only pick, and its settlement is recorded in `settlement_records` (`apps/api/src/settlement-service.ts:312-319`). It is not a data-truth defect.

### 11.4 Active work

| Work | PR / head | Lane, owner, worktree | State | Next action |
|---|---|---|---|---|
| WORK-2026110309 submission idempotency (T1, Codex) | #1830 draft, head `0650fe86364fc25353fd4af3236904636be4da4c` | branch `codex/work-2026110309-submission-idempotency-scope`; Codex via `ops:codex-exec`; lane worktree `.out/worktrees/control__work-2026110309/.out/worktrees/codex__work-2026110309-submission-idempotency-scope`; checkpoint `.out/ops/execution-checkpoints/WORK-2026110309.json` in that worktree (epoch `410933eb`, attempts 1–3 ended `failed` by design, rulings 1–4 recorded) | Implementation, regressions, both mutations, the live staging suite and the proof are on the PR. CI run `41837349837` at `0650fe863` passed `verify` and `Writable DB proof (staging only)`, including the new suite: `ok 1 - WORK0309 live staging: capper isolation, retry dedupe and immutable Track Only in both orders`, `# skipped 0`. Open: (a) the controller guard fixture needs Griff's `SCOPE_OVERRIDE`. The request and the exact patch (14/14 in a scratch worktree, plus a new mutation control for the delivery-authorization guard) are in #1830 comment `6632286109`. (b) Proof format CEP-E3/E5/E7 (ruling-4). The board-writer rerun dedupe test (`board-pick-writer.test.ts`) runs in no CI script, so its result is local only | 1. Griff posts `SCOPE_OVERRIDE` at the PR head for `apps/api/src/controllers/submit-pick-controller.test.ts`. 2. Record ruling-5 giving Codex the patch from comment `6632286109`, and state in the proof boundary that the board-writer test is local-only. 3. Dispatch one Codex attempt (`pnpm -s ops:codex-exec --issue WORK-2026110309` from the lane worktree, staging idle first). 4. One final CI run. 5. Executor result at the final head. 6. Griff `t1-approved` + `pm-verdict/v1`. 7. Merge wrapper `pr-merge`, closeout |
| WORK-2026110401 this handoff (T2, Claude) | this lane's PR | `control__work-2026110401` | In progress | Merge through normal controls |
| WORK-2026110302 Discord shared artwork (T1) | none | Work order only, on the **unpushed** local branch `control/work-2026110302` in `.out/worktrees/control__work-2026110302` (2 commits, behind `main`) | Queued: shares `apps/api/src/submission-service.ts` with 0309 and runs after it | Lane-start from that control worktree once 0309 merges |
| WORK-2026110307 performance readers keyset paging (T1) | none | Work order only, on the **unpushed** local branch `control/work-2026110307` in `.out/worktrees/control__work-2026110307` (4 commits) | Queued behind the `package.json` singleton held by 0309 | Lane-start once 0309 releases `package.json` |
| Older open PRs | #1778, #1776, #1775, #1772, #1771, #1739, #1738, #1736, #1556, #1505, #1498, #1429 | various | Not touched this session | Triage when capacity allows. Frozen: #1491, #1492, #1495. Production DDL: #1451 |

### 11.5 Private-canary blockers (in order)

1. **Cross-capper idempotency collision.** A second capper's identical wager was answered with the first capper's pick (staging, CI run `41671267309`). Fix in #1830, above.
2. **Deployed release lacks the canary audience exclusion.** Clause 5 requires the deployed release to exclude canary-audience picks from every member read before the packet is presented. #1811 merged 2026-10-31, after the deployed `913235ce7`. A deployment is Griff's dispatch.
3. **Verified Discord artwork** (0302) and **keyset-paged performance readers** (0307, so capper statistics reconcile beyond one page). Both are queued.
4. **The consolidated final packet** (destination, capper, pick scope, release windows, rollback, proof criteria) is not yet prepared. Prepare it once 1–3 are merged and a deploy carries them; presenting it is Griff's decision.

### 11.6 Outstanding acceptance outside the canary

- **Grading and CLV:** no live provider data since 2026-06-30. Automated grading and CLV on live data wait on the SGO gate (`plan.md` §7 #6). Manual-fallback picks claim no CLV.
- **Discord:** the Waves program belongs to the independent worker (`plan.md` §6.G). Member copy (#1818) is merged but not deployed.
- **Whop:** setup and lifecycle proof stay Griff's (§7 #7). `member_tiers` has 9 rows; the Whop→role lifecycle is unverified in this reading.

### 11.7 Reserved Griff decisions now pending

1. `SCOPE_OVERRIDE` on #1830 for the controller test fixture.
2. `t1-approved` + `pm-verdict/v1` on #1830 at its final head.
3. A deployment dispatch carrying the merged canary safeguards.
4. The carry-forward allowlist: a WORK-* closeout on `main` breaks approval carry-forward for other open PRs (merge authority).
5. The production `picks.participant_id` index (production DDL).
6. Standing: SGO, Whop/Discord setup, un-killing `official-picks`, the frozen PRs, #1451.

### 11.8 Safe parallel work ready to dispatch

- **Wire the unwired `apps/api` tests.** 41 of 126 `apps/api/src/*.test.ts` files run in no CI script, including `controllers/*.test.ts`, `board-pick-writer.test.ts`, `distribution-service.test.ts` and `routes/kill-switch.test.ts` (measured by the Operating session, 2026-11-04). Split into (a) in-memory unit tests and (b) a staging-writer decision for 18 historical `t1-proof-utv2-*` files. Admit after #1830 merges. Production Claude admits it.
- Prepare, but do not present, the canary packet draft.

### 11.9 Uncommitted state, running processes, staging

- **Uncommitted changes:** none in the 0309 lane worktree. The 0302 and 0307 work orders are committed but **unpushed**, on local control branches.
- **Root checkout:** the untracked `.ops/sync/*` and `docs/06_status/lanes/*` copies predate this session. Leave them.
- **Running processes:** no Codex process. A `scripts/ops/command-center-bridge.ts --local-port 14302` process (PID 783153, root checkout, up about 5 days) predates this session. Its owner is **UNKNOWN**; leave it. Session-local monitors end with the session.
- **Staging:** no reservation is held. The Operating session rotated out at about 13:55Z. Until a new one pings, check `gh run list --workflow ci.yml` is idle before any staging-bound push. A merge is two `main` arrivals. A ci.yml verify that comes back `(cancelled)` gets one full rerun, never `--failed`.
- **Merge lock:** released (`.ops/merge-lock.json`, WORK-2026110303).

### 11.10 Do not duplicate

- Do not recreate, close or re-admit WORK-2026110309. Resume its checkpoint; rulings 1–4 are recorded and carry forward.
- Do not post `SCOPE_OVERRIDE` or `pm-verdict/v1`; those are Griff's.
- Do not write new work orders for 0302 or 0307; use the control worktrees above.
- Do not repeat the 0309 impact review or mutations; they are in its proof bundle.
- Do not re-derive the controller fixture patch. It is recorded verbatim in #1830 comment `6632286109`.
