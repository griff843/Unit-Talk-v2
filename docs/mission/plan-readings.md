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
