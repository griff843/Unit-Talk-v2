# PROOF: WORK-2026111102

MERGE_SHA: pending merge

Issue: WORK-2026111102
Tier: T1
result: pass

Verified source SHA: `36f0c28599e03c0f0f29d2f9923eb3c4f8e15648` (PR #1846 code head; only proof files change after it). Restricted grading passes now load only the requested picks by id and reapply lifecycle and Track Only admission (work order steps 11-12); the unrestricted cron pass is unchanged.
`post-merge-lane-close.yml` binds the merge SHA; none is written here by hand.

## ASSERTIONS:

- [x] Final-game results from an Odds API scores payload are persisted to staging only through the operator CLI, are `completed`, carry `source = 'odds-api'`, and write exactly the four keys `game_moneyline_win`, `game_spread_margin`, `game_total_ou`, `team_total_ou` (7 rows) — test 38.
- [x] Event and team matching is exact: both team links resolve to the static-map canonical external ids; unknown, swapped, mismatched-name and wrong-sport payloads write nothing — test 38 and parser/resolver tests 5-24.
- [x] The dry run writes nothing and its blast-radius counts equal the staging apply's row counts (`events` 1, `event_participants`, `game_results`) — test 38.
- [x] A second staging apply changes zero rows (`eventsUpserted` 0, `resultsInserted` 0; event, results and links byte-identical) — test 38.
- [x] Full-game outcomes are derived from the score (Kings 113, Thunder 103) and correct for every family and side, graded by `runGradingPass` on staging: game total Over 215.5 win / Under 215.5 loss; moneyline Kings win / Thunder loss; spread Kings -5.5 win / Thunder +5.5 loss / Kings -10 push; team total Kings Over 110.5 win / Thunder Over 110.5 loss — test 38 subtests 1-9.
- [x] Settlement is idempotent: the nine picks are graded in one batched pass (graded 9, errors 0), each has exactly one settlement, and one batched replay pass grades 0 and leaves every settlement list unchanged — test 38.
- [x] Zero member delivery: every pick stays `validated`, `distribution_outbox` has no row for any pick — test 38.
- [x] No vendor contact (`vendorCalls === 0`), no provider credential, and the proof refuses any target other than the approved staging project — test 38, `ci:assert-staging`.
- [x] A restricted grading pass reads only the requested ids (`findPicksByIds`), makes zero lifecycle-population reads, never grades a missing or inadmissible id (validated non-Track-Only, draft, queued, voided, settled), and records `restricted: true` and `requested_pick_count` without claiming `no_op_no_input`; the unrestricted pass keeps its three population reads — `grading-service.test.ts` (step 11-12 tests) and the settlement-batch live proof on staging.
- [x] `odds-api` events grade only Track Only evidence-plane picks with a complete `resultsProof`, and fixture payloads only against staging or loopback — `grading-service.test.ts` 29-37.

## EVIDENCE:

CI run 43589817035 on head `36f0c28599e03c0f0f29d2f9923eb3c4f8e15648`, job "Writable DB proof (staging only)" 132432038296, conclusion success (all 33 live suites, 0 fail, no statement timeout):
https://github.com/griff843/Unit-Talk-v2/actions/runs/43589817035/job/132432038296

Test 38 timing diagnostics in that run: batched grading pass 21,080 ms for nine picks, replay 620 ms. Staging grading-query measurement (read-only): before, a restricted pass read 62,538 rows (23,197 awaiting_approval and 8,196 posted by offset paging, about 103 ms per deep page, plus 31,145 Track Only validated); after, the nine requested picks load by primary key in about 15 ms.

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

Run on the final code commit `36f0c2859` (Codex High via `ops:codex-exec`, codex-sol-high; locally, no database):

| Command | Result |
|---|---|
| Lane test files (parser, resolver, sync, grading-service, staging proof, results-resolver, ingest-odds-api), each via `tsx --test` | 220 pass, 0 fail, 1 skip (test 38, CI-only), 1 pending todo-marked test (14c, production catalog export) |
| `pnpm lint` | PASS |
| `pnpm type-check` | PASS |
| `pnpm verify:static` | PASS (8,398 pass, 0 fail, 13 skip, 1 todo-marked) |
| `pnpm verify` | static stages PASS; stops at `test:db` because `ci:assert-staging` refuses `127.0.0.1`. Not claimed green locally; writable DB proof is the CI staging job above. |
| CI `verify` and "Writable DB proof (staging only)" at `36f0c2859` | success |

Not yet verified (post-merge or PM-owned):
- Production read-only counts of `game_results` with `source = 'odds-api'` and `events` with `metadata->>'providerKey' = 'odds-api'` both 0 after merge.
- `t1-approved` label and `pm-verdict/v1` on the exact head.

D7 provider audit, re-run on the final proof content against `origin/main` `1c13033ac`: all 61 baseline findings preserved and still reported; every new finding is in this lane's own manifest or proof bundle (no code file) and names an Amendment A1 game-score file or the provenance label A1 requires; zero new unauthorized findings. Per-file counts and both full hit lists are in `.ops/work/WORK-2026111102.md`. The audit script was not edited. Disposition is with the PM.
- Scope: `apps/api/src/t1-proof-utv2-1886-settlement-batch.test.ts` changes outside the lane lock (step 12, its empty-restriction `rows_scanned` expectation only) and requires a PM `scope-override/v1` comment on the final head.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1846
Execution SHA: 36f0c28599e03c0f0f29d2f9923eb3c4f8e15648
