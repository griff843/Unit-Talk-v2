# PROOF: WORK-2026110307

MERGE_SHA: pending merge

Issue: WORK-2026110307
Tier: T1
Source SHA: f6a694f78c7124cd43ee772a15b2ca22b9bc88ae
result: draft_live_proof_deferred

## ASSERTIONS:

- [x] All six cursor callers use the shared helper: ascending `gte(created_at)` plus tuple `gt`, descending `lte(created_at)` plus tuple `lt`. Database timestamp text retains microseconds and its UTC offset.
- [x] Unit duplicate-timestamp boundaries and real SDK URL encoding preserve row order and ID tie breaks. Explicit initial offsets remain supported.
- [x] Lifecycle-state reads request an exact count with the first data page. A single-page read uses that consistent snapshot without a HEAD count; multi-page reads issue exactly one final HEAD count. Cursor pages omit count=exact. Drift restarts the entire read up to three attempts, then throws `population count changed while paging`.
- [x] Status filtering, duplicate identity, strict order, 100000-row budget, short-page termination, invalid cap and query-error guards remain covered.
- [x] Removing the timestamp bound, ID tie break, timestamp precision or boundary-count comparison fails focused tests.
- [ ] Current-source live counts, timing, seeded boundary and live mutation proof: deferred to staging-ci.

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
- Proof identity and auditor: PASS. Close eligibility fails CEP-E7 (and consequent CEP-C1), and proof binding fails only for empty current-source runtime queries/row_counts, as required while live proof is deferred. CEP-E3/E5 pass.

Writable live-DB proof is blocked/deferred locally. Required project: xskgrzbteyqdufktjrjx. Run through staging-ci with CI_SUPABASE_* credentials and CI_FIXTURE_RUN_ID. No local live writes were performed.

## Superseded runtime history

[Run 42040861746](https://github.com/griff843/Unit-Talk-v2/actions/runs/42040861746), Writable DB proof job 127291780486, passed for the older source: settled/voided 49003 rows in 25311.85 ms, Track Only validated 27697 in 13826.36 ms, validated 69527 in 38623.10 ms. Exact counts matched; the five shared-microsecond fixtures at pageSize 2 and both mutations passed. These receipts are preserved only in evidence.json superseded_history and do not bind the current source.

[Final-head run 42044986080](https://github.com/griff843/Unit-Talk-v2/actions/runs/42044986080) at 717991ba8 failed in Writable DB proof job 127306260636: t1-proof-utv2-1907 test 5 timed out on a validated data page (page 1 or 2). No staging writer overlapped. Orchestrator ruling 4 reports that the OR predicate was not an Index Cond: deep reads walked from the start (63412 buffers, 80313 rows removed). An explicit timestamp bound reduced warm 191 ms to 33 ms and 63412 buffers to 2392, preserving 9590 rows. Those supplied EXPLAIN observations motivate this change; they are not current-source runtime receipts.

## Verification boundary

| Boundary | Result |
|---|---|
| Local paging, bounds, ordering, count, transport and mutations | Proven by focused tests |
| Lint/type-check/build | Passed static subgates |
| Aggregate tests | PASS: 8102 passed, 0 failed, 13 skipped; existing service query double unchanged |
| Settled/voided staging population | Deferred to fresh staging CI |
| Track Only validated staging population | Deferred to fresh staging CI |
| Validated staging population | Deferred to fresh staging CI |
| Seeded duplicate boundary and live mutations | Deferred to fresh staging CI |
| Production schema/index/DDL/data writes | None |
| Production behavior and row counts | Unproven; nothing deployed |
| PM approval, merge, finalization, reconciliation | Pending authorized post-executor path |

Attempt 6 resolves the prior scope blocker under orchestrator ruling 5, without modifying the out-of-scope test double. Existing PR #1832 remains a draft; no PR mutation, governance comment or READY_FOR_REVIEW attestation is authorized. One final push is authorized for this continuation. Fresh staging receipts and outer-wrapper provenance remain pending.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1832
Execution SHA: f6a694f78c7124cd43ee772a15b2ca22b9bc88ae
