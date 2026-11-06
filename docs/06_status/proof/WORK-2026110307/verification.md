# PROOF: WORK-2026110307

MERGE_SHA: pending merge

Issue: WORK-2026110307
Tier: T1
Source SHA: 1a8850d5092088016a9f2372192af09aa718853b
result: draft_live_deferred

## ASSERTIONS:

- [x] The six existing bounded keyset cursor callers, exact database timestamp text, total order, page cap, short-page termination, query error handling and 100000-row budget remain unchanged.
- [x] Single-page lifecycle reads use exactly one data statement and no watermark or extra request. The out-of-scope member-performance-service test is unchanged.
- [x] A multi-page probe is discarded entirely. Each of at most three subsequent attempts reads the newest unfiltered picks.updated_at watermark, restarts with a fresh exact count, cursor, rows, identity set and ordering state, and then reads cursor pages.
- [x] After multi-page reads, check 2 counts all picks with updated_at strictly greater than W and created_at <= L, without a status filter. Check 3 counts requested members beyond the bounded last-row cursor only for unbounded population reads. The final exact population count and rows.length comparison remain.
- [x] Membership/count drift discards the attempt and retries; the third failure surfaces the last drift error. A limit-truncated read skips check 3.
- [x] T1–T7 and the microsecond stability test pass locally. Isolated mutations demonstrate the necessity of both new checks, strict gt, and precise W/L text.
- [ ] Current-source staging runtime proof is deferred to the next staging-ci run. Historical successful receipts are superseded.

The trigger was PM CHANGES REQUIRED at c143a22999a1fceb055a72c6b1aa7a4fa73d4122, comment 6684477811, confirming finding 4482558564. Rulings 8/9 and their addenda authorize this implementation. No main merge is authorized in this attempt.

Multi-page cost: one discarded first page of at most POSTGREST_MAX_ROWS (1000) rows, a watermark query and up to three HEAD counts, in addition to the fresh full data read. A bounded read omits the beyond-cursor HEAD. Drift retries repeat W and the full read, with no new probe. If the restarted first page ends the read, its statement snapshot is authoritative and all HEAD checks are skipped.

## EVIDENCE:

The following two fenced blocks are historical evidence from the superseded source, retained for provenance and proof format. They do not prove the current source.

The following lines are excerpted from CI run 42050230261 / Writable DB proof job 127324426051; elapsedMs is rounded to 2 decimals.

```text
ok 1 - WORK0307 staging: complete readers and duplicate timestamp boundary mutations
# tests 1
# pass 1
# fail 0
# skipped 0
ok 5 - WORK-2026101401: repaired performance readers reconcile with exact live PostgREST counts
{"label":"settled-voided","exactCount":49099,"rows":49099,"elapsedMs":16065.17,"statementTimeoutMs":8000}
{"label":"track-only-validated","exactCount":27775,"rows":27775,"elapsedMs":8942.23,"statementTimeoutMs":8000}
{"label":"validated","exactCount":69690,"rows":69690,"elapsedMs":16118.40,"statementTimeoutMs":8000}
```

Attempt 7 gate commands already recorded below (all exit 0):

```text
Local close-eligibility preflight: invoked evaluateCloseEligibilityPreflight via pnpm exec tsx --eval, reading the lane manifest and all declared/on-disk proof artifacts exactly as close-eligibility-preflight.yml does.
pnpm exec tsx scripts/ops/proof-schema.ts proof-identity --phase pre-merge --verification docs/06_status/proof/WORK-2026110307/verification.md --evidence docs/06_status/proof/WORK-2026110307/evidence.json
pnpm exec tsx scripts/ci/proof-binding-validator.ts --proof-dir docs/06_status/proof/WORK-2026110307 --json
pnpm ops:proof-auditor-gate -- --proof-dir docs/06_status/proof/WORK-2026110307 --sha f6a694f78c7124cd43ee772a15b2ca22b9bc88ae --json
npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
```


Current local source: 1a8850d5092088016a9f2372192af09aa718853b. Focused suites: 193 tests, 192 pass, 0 fail, 1 staging credential skip (paging 125 pass, server 67 pass). The unchanged live suite ran without credentials and skipped; no new fixtures or live diagnostics were added.

T1 reproduces the exact 3000-row, three-page attack: a page-1 member departs, another enters ahead of the cursor before page 3, and the population count returns to 3000. The stable retry equals the current population by ordered IDs and excludes the departed row. T2 isolates a count-restoring swap entirely behind the cursor; T3 isolates a hard delete plus a new insert beyond the initial total. T4 fails after exactly three membership-drift attempts. T5 checks single-page request counts. T6 succeeds with a bounded multi-page limit and no beyond check. T7 asserts probe, W, fresh counted first page, cursor pages, checks 2/3/4 in order and excludes every departed probe row.

Previous source against the new tests: 112 pass, 13 fail, including T1/T2/T3/T4/T7. This is a source-regression control, not a claim that all 13 failures are independent product defects. Original offset paging passed stable duplicate timestamps because it already preserves total order; its cursor/encoding/retry regressions remain recorded in evidence.json.

Attempt 10 isolated temporary-copy mutations (all 125 tests run directly with tsx --test; temporary copies deleted):
- Control: 125 pass, 0 fail.
- Remove check 2: 120 pass, 5 fail, including T2.
- Remove check 3: 121 pass, 4 fail, including T3.
- W comparison gt -> gte: 109 pass, 16 fail, including stable microsecond paging; the existing newest row causes all three attempts to fail closed.
- Date-reserialize W: 109 pass, 16 fail, including stable microsecond paging.
- Date-reserialize L: 123 pass, 2 fail, including T2.
Prior isolated controls remain: remove timestamp bound 7 failures, remove ID tie break 41, Date cursor 7, remove start/end count comparison 3; always skip end count 5 failures. No mutation contacted a live database.

## Verification

Current attempt gates and log hashes are recorded in evidence.json static_proof.attempt_10. pnpm verify:static PASS through the full pnpm verify command: lint, type-check, build, aggregate tests, post-migration tests, Smart Form verify and command verification all completed. Completed TAP totals: 8122 tests, 8109 pass, 0 fail, 13 skipped. Optional browser E2E was not enabled. Final standalone pnpm type-check also passed. Full pnpm verify exited 1 only when test:live-db reached the staging identity guard after the static gate passed. Local test:db is blocked/deferred: target identity could not be resolved (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx and staging-ci CI_SUPABASE_* credentials; the guard refused before writes. Current-source runtime_proof.queries and row_counts are intentionally empty, so CEP-E7 and proof binding remain deferred rather than falsely passing.

Attempt 10 proof gates: proof identity PASS (schema-v2, no failures); proof auditor PASS (no failures/warnings); R-level PASS (no matched rules). Local close-eligibility preflight is BLOCKED only by CEP-E7 and consequent CEP-C1; CEP-E3/E5 pass. Proof binding is DEFERRED/FAIL solely because current-source runtime queries and row counts are empty by instruction. This is not merge eligibility or completed closeout.

Gate commands:

- pnpm exec tsx /tmp/work0307-preflight.mts (same manifest/artifact inputs and evaluateCloseEligibilityPreflight call as close-eligibility-preflight.yml).
- pnpm exec tsx scripts/ops/proof-schema.ts proof-identity --phase pre-merge --verification docs/06_status/proof/WORK-2026110307/verification.md --evidence docs/06_status/proof/WORK-2026110307/evidence.json
- pnpm exec tsx scripts/ci/proof-binding-validator.ts --proof-dir docs/06_status/proof/WORK-2026110307 --json
- pnpm ops:proof-auditor-gate -- --proof-dir docs/06_status/proof/WORK-2026110307 --sha 1a8850d5092088016a9f2372192af09aa718853b --json
- npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD

## Drift coverage and residual limits

The updated guard detects the tested count-restoring intermediate drift. The final net-count comparison remains: it is the only check that detects a hard DELETE of an already-read row with no compensating insert. Hard deletes of picks are absent from repository code and are a Griff-reserved production action.

picks_set_updated_at uses now(), the transaction start time. A transaction that starts before W is read and commits during the read can carry updated_at <= W and remain invisible to check 2. Checks 3/4 still see an added member beyond the cursor or a changed count. A pure same-count status swap from that straddling transaction remains undetected. The timing window is unmeasured and not covered.

Check 2 is coarser than membership: any picks UPDATE with created_at <= L triggers a retry even if membership stays unchanged. Busy staging writers can exhaust all three retries and correctly fail closed. Do not interpret that outcome as a defect or loosen the guard.

Operating Claude measured read-only on 2026-11-06: staging picks 200426 rows, watermark sequential scan 125 ms, unfiltered HEAD count 120 ms; production picks 107851 rows. These are supplied Operating Claude measurements, not measurements by this executor or current-source runtime receipts.

The other five keyset readers are unchanged:

| Reader/callback | Filter columns | Can membership change mid-read? |
|---|---|---|
| listTrackOnlyByLifecycleState | picks.status; metadata->>distributionMode | Yes: status/metadata updates and inserts |
| listPromotedByLifecycleStates promotion branch | picks.status, promotion_status, promotion_target IS NOT NULL | Yes: status/promotion updates and inserts |
| listPromotedByLifecycleStates authorized-human branch | picks.status; metadata->>distributionMode; metadata->deliveryAuthorization->>decision | Yes: status/authorization updates and inserts |
| DatabaseOutboxRepository.listByPickId | distribution_outbox.pick_id | Yes: new outbox rows; existing filter identity is ordinarily stable |
| DatabaseSettlementRepository.listByPick | settlement_records.pick_id | Yes: appended settlement/correction rows; existing rows are immutable |

These five callbacks do not receive the new picks watermark guard. Outbox and settlement readers retain their existing exact-count/progression checks; this change does not certify snapshot membership for them.

## Superseded staging proof

Run 42050230261 / Writable DB proof job 127324426051 passed for source f6a694f78c7124cd43ee772a15b2ca22b9bc88ae. It proved settled/voided 49099 = exact count (16065.17 ms), Track Only validated 27775 (8942.23 ms) and validated 69690 (16118.40 ms), with 8000 ms timeout per page. The seeded five-row, pageSize-2 microsecond boundary and noId/Date mutations passed. These receipts, and historical runs 42053943830 and 42057587335, are retained in evidence.json superseded_history and do not bind the new source.

## Superseded runtime history

[Run 42040861746](https://github.com/griff843/Unit-Talk-v2/actions/runs/42040861746), Writable DB proof job 127291780486, passed for the older source: settled/voided 49003 rows in 25311.85 ms, Track Only validated 27697 in 13826.36 ms, validated 69527 in 38623.10 ms. Exact counts matched; the five shared-microsecond fixtures at pageSize 2 and both mutations passed. These receipts are preserved only in evidence.json superseded_history and do not bind the current source.

[Final-head run 42044986080](https://github.com/griff843/Unit-Talk-v2/actions/runs/42044986080) at 717991ba8 failed in Writable DB proof job 127306260636: t1-proof-utv2-1907 test 5 timed out on a validated data page (page 1 or 2). No staging writer overlapped. Orchestrator ruling 4 reports that the OR predicate was not an Index Cond: deep reads walked from the start (63412 buffers, 80313 rows removed). An explicit timestamp bound reduced warm 191 ms to 33 ms and 63412 buffers to 2392, preserving 9590 rows. Those supplied EXPLAIN observations motivate this change; they are not current-source runtime receipts. The cause of the page-1/2 stall in run 42044986080 is not identified. Exposure is reduced rather than eliminated; the deep-page scan defect does not establish the cause of that early-page stall.


## Verification boundary

| Boundary | Result |
|---|---|
| Local keyset ordering, cap, transport, retries, T1–T7 and mutations | Proven by focused tests |
| Count-restoring intermediate drift | Proven by unit tests and mutations only; live not observed |
| Current-source lint/type-check/build/aggregate tests | PASS: 8109 pass, 0 fail, 13 skips; existing member-performance-service test unchanged |
| Current-source settled/voided, Track Only validated and validated staging timings/counts | Deferred to next staging-ci; receipts empty |
| Current-source live seeded boundary and mutations | Deferred to next staging-ci |
| Transaction straddling W with updated_at <= W | Not covered; window unmeasured; pure same-count swap can escape |
| Retries caused by unrelated picks updates; busy-writer retry exhaustion | Expected fail-closed behavior; frequency/cost not measured |
| Production behavior and row counts | Not proven; nothing deployed |
| Production schema/index/DDL/data writes | None |
| Cause of 42044986080 page-1/2 stall | Not identified; exposure reduced rather than eliminated |
| PM approval, exact-head CI, executor result, final main sync, merge, finalization | Pending authorized outer path |

No PR opening/closing/ready/comment actions or executor READY_FOR_REVIEW attestation. One final push is authorized after local commits; no main sync in this attempt. Run-namespaced fixtures from cancelled run 42216379304 were not cleared; reaping is Griff's decision.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1832
Execution SHA: 1a8850d5092088016a9f2372192af09aa718853b
