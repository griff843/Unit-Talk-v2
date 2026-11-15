# PROOF: WORK-2026111102

MERGE_SHA: pending merge

Issue: WORK-2026111102
Tier: T1
result: pass

Verified source SHA: `cb2488a3ec010fe4f878ba74e614bb90a424b5bd` (PR #1846 code head; only proof files change after it). Restricted grading passes load only the requested picks by id and reapply lifecycle and Track Only admission (steps 11-12); the unrestricted cron pass is unchanged. The results writer completes an event only after all seven result rows are durable, and grading refuses a results-proven event whose seven-row set is incomplete or contradictory (steps 13-13b, PM binding review of `7cb1fd397`).
`post-merge-lane-close.yml` binds the merge SHA; none is written here by hand.

## ASSERTIONS:

- [x] Final-game results from an Odds API scores payload are persisted to staging only through the operator CLI, are `completed`, carry `source = 'odds-api'`, and write exactly the four keys `game_moneyline_win`, `game_spread_margin`, `game_total_ou`, `team_total_ou` (7 rows) — test 38.
- [x] Event and team matching is exact: both team links resolve to the static-map canonical external ids; unknown, swapped, mismatched-name and wrong-sport payloads write nothing — test 38 and parser/resolver tests 5-24.
- [x] The dry run writes nothing and its blast-radius counts equal the staging apply's row counts (`event_participants`, `game_results`; `events` records 2 writes for 1 new event: uncompleted, then completing) — test 38.
- [x] A second staging apply changes zero rows (`eventsUpserted` 0, `resultsInserted` 0; event, results and links byte-identical) — test 38.
- [x] Full-game outcomes are derived from the score (Kings 113, Thunder 103) and correct for every family and side, graded by `runGradingPass` on staging: game total Over 215.5 win / Under 215.5 loss; moneyline Kings win / Thunder loss; spread Kings -5.5 win / Thunder +5.5 loss / Kings -10 push; team total Kings Over 110.5 win / Thunder Over 110.5 loss — test 38 subtests 1-9.
- [x] Settlement is idempotent: the nine picks are graded in one batched pass (graded 9, errors 0), each has exactly one settlement, and one batched replay pass grades 0 and leaves every settlement list unchanged — test 38.
- [x] Zero member delivery: every pick stays `validated`, `distribution_outbox` has no row for any pick — test 38.
- [x] No vendor contact (`vendorCalls === 0`), no provider credential, and the proof refuses any target other than the approved staging project — test 38, `ci:assert-staging`.
- [x] A restricted grading pass reads only the requested ids (`findPicksByIds`), makes zero lifecycle-population reads, never grades a missing or inadmissible id (validated non-Track-Only, draft, queued, voided, settled), and records `restricted: true` and `requested_pick_count` without claiming `no_op_no_input`; the unrestricted pass keeps its three population reads — `grading-service.test.ts` (step 11-12 tests) and the settlement-batch live proof on staging.
- [x] A partially written event is never completed or gradeable: on staging, a results apply interrupted after the first insert leaves the event uncompleted, without `resultsProof`, with 1 row, and a Track Only pick on it grades 0 (`event_not_completed`) with no settlement and no outbox row; a second interruption leaves 4 rows and still grades 0 — test 38.
- [x] A same-source retry completes the missing identical rows: the healthy resume inserts the 3 missing rows, marks the event `completed` with `resultsProof`, and the pick then grades once (win), with exactly one settlement, still `validated`, no outbox row; a repeated apply writes nothing and a replay pass grades 0 — test 38; interruption after 1, 4 and 7 inserts and legacy repair in `odds-api-scores-resolver.test.ts`.
- [x] Conflicts fail closed before any write: an existing `odds-api` row with a different value or `sourced_at`, or an unexpected row, skips the event (`conflicting_results`) with zero writes and leaves an already completed, proven event and its seven rows unchanged; another provider's row still blocks the event (`results_already_present`) — `odds-api-scores-resolver.test.ts`.
- [x] Two concurrent final applies on staging end with exactly seven rows, one per key, all `odds-api` at the fixture `last_update`, and the event completed with `resultsProof`; the existing unique constraints (`(event_id, participant_id, market_key, source)` and the partial index for the null-participant game total) prevent duplicates, and the writer checks every row an insert returns — test 38 and `odds-api-scores-resolver.test.ts`.
- [x] Grading refuses a results-proven event unless it has exactly seven same-source rows matching its home and away links and the proof's `providerLastUpdate`, with consistent totals, margins and moneylines (`odds_api_results_incomplete`, `odds_api_results_inconsistent`); no settlement, no outbox row — `grading-service.test.ts`.
- [x] `odds-api` events grade only Track Only evidence-plane picks with a complete `resultsProof`, and fixture payloads only against staging or loopback — `grading-service.test.ts` 29-37.

## EVIDENCE:

CI run 43611503349 on head `cb2488a3ec010fe4f878ba74e614bb90a424b5bd`, job "Writable DB proof (staging only)" 132497338503, conclusion success (every live suite passes, 0 fail, no statement timeout):
https://github.com/griff843/Unit-Talk-v2/actions/runs/43611503349/job/132497338503

Test 38 timing diagnostics in that run: batched grading pass 24,336 ms for nine picks, replay 746 ms; interruption-recovery passes 748 ms (after the first interruption), 678 ms (after the second), 2,887 ms (recovered event) and 561 ms (its replay). Staging grading-query measurement (read-only): before, a restricted pass read 62,538 rows (23,197 awaiting_approval and 8,196 posted by offset paging, about 103 ms per deep page, plus 31,145 Track Only validated); after, the nine requested picks load by primary key in about 15 ms.

Command: `pnpm test:t1-proof:live` (target asserted by `pnpm ci:assert-staging`: "OK: target is the approved staging project")

```
# Subtest: WORK-2026111102 38. fixture to staging results to Track Only settlement, with no delivery
    ok 1 - game_total_ou: Over 215.5 -> win
    ok 2 - game_total_ou: Under 215.5 -> loss
    ok 3 - moneyline: Sacramento Kings -> win
    ok 4 - moneyline: Oklahoma City Thunder -> loss
    ok 5 - spread: Sacramento Kings -5.5 -> win
    ok 6 - spread: Oklahoma City Thunder +5.5 -> loss
    ok 7 - spread: Sacramento Kings -10 -> push
    ok 8 - team_total_ou: Sacramento Kings Over 110.5 -> win
    ok 9 - team_total_ou: Oklahoma City Thunder Over 110.5 -> loss
    1..9
ok 1 - WORK-2026111102 38. fixture to staging results to Track Only settlement, with no delivery
# tests 10
# pass 10
# fail 0
```

Command: `pnpm test:db` (same job)

```
ok 1 - ingestor health check canonical freshness SELECT executes against staging
...
ok 9 - UTV2-996: correction chain is additive — original settlement row is not mutated
1..9
# tests 9
```

Same CI run, job `verify`: success.

## Verification

Run on the final code commit `cb2488a3e` (Codex High via `ops:codex-exec`, codex-sol-high; locally, no database):

| Command | Result |
|---|---|
| Lane test files (parser, resolver, sync, grading-service, staging proof, results-resolver, ingest-odds-api), each via `tsx --test` | 245 pass, 0 fail, 1 skip (test 38, CI-only), 1 pending todo-marked test (14c, production catalog export) |
| `pnpm lint` | PASS |
| `pnpm type-check` | PASS |
| `pnpm verify:static` | PASS (8,423 pass, 0 fail, 13 skip, 1 todo-marked) |
| `pnpm verify` | static stages PASS; stops at `test:db` because `ci:assert-staging` refuses `127.0.0.1`. Not claimed green locally; writable DB proof is the CI staging job above. |
| CI `verify` and "Writable DB proof (staging only)" at `cb2488a3e` | success |

Not yet verified (post-merge or PM-owned):
- Production read-only counts of `game_results` with `source = 'odds-api'` and `events` with `metadata->>'providerKey' = 'odds-api'` both 0 after merge.
- `t1-approved` label and `pm-verdict/v1` on the exact head.

Known limitations, recorded for PM decision and not implemented (independent review of `6eae2f6fb` and `cb2488a3e`; each fails closed, so no partial or contradictory event grades):
- Two first-time applies of the same new game race on event creation (`events.external_id` is unique); the losing run exits 1 and writes no result. Test 38 stages the event first so its concurrent section isolates the results race.
- A conflicting concurrent apply can remove `resultsProof` from a just-completed event; grading then refuses it (`event_provenance_results_proof_missing`) until an identical apply restores it. Closing this needs a conditional-update repository primitive.
- After an interruption, a later provider `last_update` with the same score leaves the partial event unrepairable (`conflicting_results`). Only live ingestion can produce this, and live ingestion is not authorized.
- A run whose events end `conflicting_results` or `results_incomplete` is recorded `succeeded`; the reasons are in `summary.skipped`. `resultsInserted` can over-count under concurrency.

D7 provider audit, re-run on the final proof content against `origin/main` `2e3bc1b5c`: all 61 baseline findings preserved and still reported; 34 new (the 28 the PM dispositioned at `7cb1fd397`, two of them reworded, plus 6 step 13 proof lines); every new finding is in this lane's own manifest or proof bundle (no code file) and names an Amendment A1 game-score file or the provenance label A1 requires; zero new unauthorized findings. Per-file counts and both full hit lists are in `.ops/work/WORK-2026111102.md`. The audit script was not edited. Disposition is with the PM.
- Scope: `apps/api/src/t1-proof-utv2-1886-settlement-batch.test.ts` changes outside the lane lock (step 12, its empty-restriction `rows_scanned` expectation only) and requires a PM `scope-override/v1` comment on the final head.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1846
Execution SHA: cb2488a3ec010fe4f878ba74e614bb90a424b5bd
