# PROOF: WORK-2026110307

MERGE_SHA: pending merge

Issue: WORK-2026110307
Tier: T1
Source SHA: f6a694f78c7124cd43ee772a15b2ca22b9bc88ae
result: draft_staging_proven

## ASSERTIONS:

- [x] All six cursor callers use the shared helper: ascending `gte(created_at)` plus tuple `gt`, descending `lte(created_at)` plus tuple `lt`. Database timestamp text retains microseconds and its UTC offset.
- [x] Unit duplicate-timestamp boundaries and real SDK URL encoding preserve row order and ID tie breaks. Explicit initial offsets remain supported.
- [x] Lifecycle-state reads request an exact count with the first data page. A single-page read uses that consistent snapshot without a HEAD count; multi-page reads issue exactly one final HEAD count. Cursor pages omit count=exact. Drift restarts the entire read up to three attempts, then throws `population count changed while paging`.
- [x] Status filtering, duplicate identity, strict order, 100000-row budget, short-page termination, invalid cap and query-error guards remain covered.
- [x] Removing the timestamp bound, ID tie break, timestamp precision or boundary-count comparison fails focused tests.
- [x] Current-source staging CI proves exact counts, completion under the per-page statement timeout, the seeded duplicate boundary and both live mutations (run 42050230261, job 127324426051).

Drift detection is net-count at read boundaries, so an insert and a delete that cancel out during one read are not detected. Per-page counting did not detect that either. Rows from failed attempts are discarded; each retry starts with a fresh cursor, result and identity set.

## EVIDENCE:

Current source SHA: f6a694f78c7124cd43ee772a15b2ca22b9bc88ae. Merged origin/main `4d34da992` with a no-ff merge before the source/proof commits; only readiness-score.json came from main.

Attempt 6 focused paging, server and credential-skipped live suites: 186 tests, 185 passed, 0 failed, 1 staging skip. Server contributes 67 passed; paging contributes 118 passed. The single-page tests prove exactly one picks request and no HEAD count for empty and short pages; multi-page tests prove the end count and three bounded retries. The out-of-scope member-performance-service test remains unchanged.

Isolated temporary-module controls: unchanged copy 114 passed; removed timestamp bound 107 passed / 7 failed; removed ID tie break 73 passed / 41 failed; Date reserialization 107 passed / 7 failed; removed start/end count comparison 111 passed / 3 failed. The bound mutation removes the bound calls, rather than returning the original mutable builder after calling them. Dependencies link to the DB package; temporary copies were deleted.

Attempt 6 isolated mutation always skips the final count: 113 passed / 5 failed, including the explicit three-attempt multi-page drift test. No live database was used.

Regression-first history: the old offset reader passed stable-population duplicate-timestamp cases because offset already preserves that total order. Original cursor-progress, SDK/encoding and retry tests failed on it (100 passed / 11 failed; three adapted count-double failures were not claimed as product regressions). Attempt 5 specifically adds query-shape regression coverage for index bounds.

## Verification

- Focused tests: PASS (185 passed, 0 failed, 1 staging skip); standalone paging: 118 passed, 0 failed.
- `pnpm verify:static`: PASS as the required first stage of `pnpm verify`, including lint, type-check, build, aggregate tests, post-migration tests, Smart Form verification and command verification. Completed TAP totals: 8115 tests, 8102 passed, 0 failed, 13 skipped. The existing member-performance-service test and its two-read assertion pass unchanged. Optional Smart Form browser E2E was not enabled.
- Required `pnpm verify`: exit 1 only after the static gate passed, when test:live-db refused the unresolved local database target.
- `pnpm test:db`: BLOCKED/DEFERRED; staging identity guard refused host=127.0.0.1 before any writable test.
- R-level: PASS; no matched rules.
- Attempt 7 local close-eligibility preflight: PASS (`eligible=true`, `blocking=[]`); CEP-E3/E5/E7 all pass. Proof identity: PASS (schema-v2 pre-merge, failures=[]). Proof binding: PASS (ok=true, violations=[]), bound to source f6a694f78c7124cd43ee772a15b2ca22b9bc88ae. Proof auditor: PASS (failures=[], warnings=[]). R-level: PASS, no matched rules. This preflight does not certify truth-check success, PM approval, merge or lane closure. Gate log SHA-256 digests are in evidence.json under static_proof.attempt_7_closeout.

Attempt 7 gate commands (all exit 0):

- Local close-eligibility preflight: invoked `evaluateCloseEligibilityPreflight` via `pnpm exec tsx --eval`, reading the lane manifest and all declared/on-disk proof artifacts exactly as close-eligibility-preflight.yml does.
- `pnpm exec tsx scripts/ops/proof-schema.ts proof-identity --phase pre-merge --verification docs/06_status/proof/WORK-2026110307/verification.md --evidence docs/06_status/proof/WORK-2026110307/evidence.json`
- `pnpm exec tsx scripts/ci/proof-binding-validator.ts --proof-dir docs/06_status/proof/WORK-2026110307 --json`
- `pnpm ops:proof-auditor-gate -- --proof-dir docs/06_status/proof/WORK-2026110307 --sha f6a694f78c7124cd43ee772a15b2ca22b9bc88ae --json`
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`

Writable live-DB verification remains blocked locally by the target identity guard; no local live writes were performed. The required staging proof for xskgrzbteyqdufktjrjx is now proven by staging-ci using CI_SUPABASE_* credentials and CI_FIXTURE_RUN_ID, as supplied by orchestrator ruling 6. The earlier local verify exit remains historical; CI verify passed for the tested source.

## Current-source staging CI proof

[Run 42050230261](https://github.com/griff843/Unit-Talk-v2/actions/runs/42050230261) tested head f9cbc60c953ea079cea650ec85e1bae5ae713088, which contains the unchanged source f6a694f78c7124cd43ee772a15b2ca22b9bc88ae. [Writable DB proof job 127324426051](https://github.com/griff843/Unit-Talk-v2/actions/runs/42050230261/job/127324426051) and verify job 127330848150 both succeeded. The WORK0307 live suite passed: tests 1, pass 1, fail 0, skipped 0.

| Reader | Exact PostgREST count | Returned rows | Whole-read elapsed ms | Statement timeout ms per page |
|---|---:|---:|---:|---:|
| Settled/voided | 49099 | 49099 | 16065.17 | 8000 |
| Track Only validated | 27775 | 27775 | 8942.23 | 8000 |
| Validated | 69690 | 69690 | 16118.40 | 8000 |

Whole-read durations span multiple queries; 8000 ms is the timeout for each page query. All reads completed and matched exact counts. Five fixtures in namespace `work0307-utv2-1630-42050230261-1-979bcaae-4af5-446f-917f-ad5623f23a7b` share exact database timestamp `2026-11-03T12:34:56.123456+00:00`. Reading at pageSize 2 matched the oracle by deepEqual; `noId` and `dateReserialization` mutations were both rejected. In the same job, t1-proof-utv2-1907 test 5 (repaired performance readers reconcile with exact live PostgREST counts) passed; this is the test that timed out in run 42044986080. These are staging CI receipts supplied by ruling 6, not local live results.

## Superseded runtime history

[Run 42040861746](https://github.com/griff843/Unit-Talk-v2/actions/runs/42040861746), Writable DB proof job 127291780486, passed for the older source: settled/voided 49003 rows in 25311.85 ms, Track Only validated 27697 in 13826.36 ms, validated 69527 in 38623.10 ms. Exact counts matched; the five shared-microsecond fixtures at pageSize 2 and both mutations passed. These receipts are preserved only in evidence.json superseded_history and do not bind the current source.

[Final-head run 42044986080](https://github.com/griff843/Unit-Talk-v2/actions/runs/42044986080) at 717991ba8 failed in Writable DB proof job 127306260636: t1-proof-utv2-1907 test 5 timed out on a validated data page (page 1 or 2). No staging writer overlapped. Orchestrator ruling 4 reports that the OR predicate was not an Index Cond: deep reads walked from the start (63412 buffers, 80313 rows removed). An explicit timestamp bound reduced warm 191 ms to 33 ms and 63412 buffers to 2392, preserving 9590 rows. Those supplied EXPLAIN observations motivate this change; they are not current-source runtime receipts. The cause of the page-1/2 stall in run 42044986080 is not identified. Exposure is reduced rather than eliminated; the deep-page scan defect does not establish the cause of that early-page stall.

## Verification boundary

| Boundary | Result |
|---|---|
| Local paging, bounds, ordering, count, transport and mutations | Proven by focused tests |
| Lint/type-check/build | Passed static subgates |
| Aggregate tests | PASS: 8102 passed, 0 failed, 13 skipped; existing service query double unchanged |
| Settled/voided staging population | Proven: 49099 rows = exact count; 16065.17 ms whole read |
| Track Only validated staging population | Proven: 27775 rows = exact count; 8942.23 ms whole read |
| Validated staging population | Proven: 69690 rows = exact count; 16118.40 ms whole read |
| Seeded duplicate boundary and live mutations | Proven: five shared-timestamp rows, pageSize 2, both mutations rejected |
| Production schema/index/DDL/data writes | None |
| Production behavior and row counts | Not proven; nothing deployed |
| Cause of 42044986080 page-1/2 stall | Not identified; exposure reduced rather than eliminated |
| PM approval, merge, finalization, reconciliation | Pending authorized post-executor path |

Attempt 7 updates evidence only under ruling 6; source and tests remain unchanged. Existing PR #1832 remains a draft; no PR mutation, governance comment or READY_FOR_REVIEW attestation is authorized. One final push is authorized for this continuation. Outer-wrapper provenance, PM approval, merge and canonical post-merge closeout remain pending.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1832
Execution SHA: f6a694f78c7124cd43ee772a15b2ca22b9bc88ae
