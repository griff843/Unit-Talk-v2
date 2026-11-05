# PROOF: WORK-2026110307

MERGE_SHA: pending merge

Issue: WORK-2026110307
Tier: T1
Source SHA: 4e351399be1b22510923486893d252a5a3584855
result: draft_staging_proven

## ASSERTIONS:

- [x] All six callbacks use the last database `(created_at, id)` tuple; subsequent ranges start at zero. Descending histories use `<`, ascending picks use `>`.
- [x] Duplicate timestamps cross page boundaries without skips or duplicates; SDK transport checks all six callbacks and encodes `+00:00` exactly once while retaining all microseconds.
- [x] Short pages end reads; oversized page caps and page errors fail. Existing explicit limit/offset contracts and completeness/order/budget checks remain covered.
- [x] A count change, including deletion behind the cursor, restarts the whole pick read. Three unstable attempts fail with `population count changed while paging`. Each attempt owns a fresh result, cursor, count and identity set.
- [x] Local mutations removing the ID tie break, truncating timestamps through Date, and removing the count comparison fail tests.
- [x] Live population timing/count reconciliation and seeded boundary/mutation evidence: proven in staging CI run 42040861746, Writable DB proof job 127291780486.

## EVIDENCE:

Focused command: `pnpm exec tsx --test apps/api/src/t1-proof-work-2026110307-keyset-paging-live.test.ts packages/db/src/member-performance-read-completeness.test.ts`.

```text
focused: tests 112, pass 111, fail 0, skipped 1 (staging proof)
server.test.ts: tests 67, pass 67, fail 0
DB writer inventory: ok=true, discovered_credentialed_tests=62
R-level: Verdict PASS; no matched rules, no additional R-level artifacts required
old offset reader: pass 100, fail 11
no-id mutation: pass 73, fail 38
Date mutation: pass 106, fail 5
count-comparison mutation: pass 108, fail 3
```

The original offset reader already passes the stable-population duplicate-timestamp row-set cases. Its regression failures are cursor progress/SDK encoding and bounded retry assertions. Three adapted count-double cases also fail under its old offset contract; those are not evidence of an original row-set bug. Baseline and mutations were executed against temporary module copies with dependencies linked to this checkout, then deleted; the working source stayed intact. The first exploratory baseline attempt was terminated because a cursor-aware fake repeated its first page; the final bounded run above completed normally.

The live suite submits five run-namespaced Track Only fixtures through `processSubmission`, changes only their `created_at` to one shared microsecond timestamp, reads with page size two, and checks the independent ordered DB result. It also asserts that dropping the ID tie break and re-serializing the timestamp through Date fail. These live assertions passed in staging CI; they were not run locally. Fixture records are retained with their namespace; no audit history is deleted or lifecycle state written directly.

## Verification

- Focused issue tests: PASS, with one explicit staging skip.
- API server tests: PASS (67/67).
- `pnpm exec tsx scripts/ci/db-writer-inventory.ts`: PASS.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS.
- `pnpm verify:static` (final run inside `pnpm verify`): PASS, including lint, type-check, build, aggregate tests, post-migration tests, Smart Form verification and command verification. Across local TAP blocks: 8,108 tests, 8,095 passed, 0 failed, 13 skipped. Browser Smart Form e2e was not enabled.
- `pnpm verify`: exit 1 at the following `test:live-db` staging identity gate. This historical local gate is not green; the later staging CI verify job passed (see attempt 3).
- Prior proof markdown binding and declared routing validation: PASS. Missing runtime queries and row counts from the prior attempt are supplied by the green staging CI run below.
- Historical local `pnpm test:db`: BLOCKED/DEFERRED, exit 1. The staging identity guard refused host=127.0.0.1 before running writable tests.

The original local precondition deferred writable live-DB proof because target identity could not be resolved (host=unparseable). Required staging project: xskgrzbteyqdufktjrjx. This was subsequently proven through staging-ci with CI_SUPABASE_* credentials.

The paragraph above records the packet's precondition. The measured local `test:db` guard identified host=127.0.0.1. The local guard result is not live performance evidence.

## Attempt 2 verification

Source SHA: 4e351399be1b22510923486893d252a5a3584855

The staging fixture assertion now uses `assert.notEqual(result.duplicate, true)`: fresh submissions omit the optional field. The remaining live assertions contain no similar optional-field defect. Runtime reader code is unchanged.

- Focused paging, server and live suites: 179 tests, 178 passed, 0 failed, 1 staging skip.
- `pnpm verify:static` inside `pnpm verify`: PASS; 8,108 tests, 8,095 passed, 0 failed, 13 skipped across local TAP blocks.
- `pnpm verify`: exit 1 at the staging identity guard (host=127.0.0.1); writable tests did not run.
- R-level: PASS; no matched rules.
- At attempt 2, live timing, exact counts and seeded boundary/mutation proof were deferred. Attempt 3 supplies the green staging CI receipts below.

## Attempt 3 staging CI evidence

[CI run 42040861746](https://github.com/griff843/Unit-Talk-v2/actions/runs/42040861746) at `b5edaa06d247c8c3e94d2f6058f093f98979ab46` passed. [Writable DB proof job 127291780486](https://github.com/griff843/Unit-Talk-v2/actions/runs/42040861746/job/127291780486) and [verify job 127297871755](https://github.com/griff843/Unit-Talk-v2/actions/runs/42040861746/job/127297871755) succeeded. These receipts are supplied by authoritative orchestrator ruling 3.

Live suite: `ok 1 - WORK0307 staging: complete readers and duplicate timestamp boundary mutations`; tests 1, pass 1, fail 0, skipped 0.

| Staging reader | Exact PostgREST count | Returned rows | Whole-read elapsed ms |
|---|---:|---:|---:|
| settled-voided | 49003 | 49003 | 25311.85 |
| track-only-validated | 27697 | 27697 | 13826.36 |
| validated | 69527 | 69527 | 38623.10 |

The statement timeout is 8000 ms per page query. Every read completed without a page timeout and matched its exact count. Whole-read durations above span multiple queries; they are not individual page timings.

Five run-namespaced staging fixtures shared `created_at=2026-11-03T12:34:56.123456+00:00`. With pageSize 2, the result deep-equaled the independent ordered oracle. Both live mutations were rejected: `noId` and `dateReserialization`. Production behavior and production row counts are unproven because nothing is deployed.

## Attempt 4 local proof validation

Evidence-only continuation: no source or test files changed. The staging receipts above were carried forward from attempt 3 and checked against orchestrator ruling 3.

- Local close-eligibility preflight, using `evaluateCloseEligibilityPreflight` as the workflow does: PASS; eligible=true, blocking=[]; CEP-E3, CEP-E5 and CEP-E7 pass.
- `pnpm exec tsx scripts/ops/proof-schema.ts proof-identity --phase pre-merge --verification docs/06_status/proof/WORK-2026110307/verification.md --evidence docs/06_status/proof/WORK-2026110307/evidence.json`: PASS; schema-v2, failures=[].
- `pnpm exec tsx scripts/ci/proof-binding-validator.ts --proof-dir docs/06_status/proof/WORK-2026110307 --json`: PASS; ok=true, violations=[].
- `pnpm ops:proof-auditor-gate -- --proof-dir docs/06_status/proof/WORK-2026110307 --sha 4e351399be1b22510923486893d252a5a3584855 --json`: PASS; failures=[], warnings=[].
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS; no matched rules.

## Verification boundary

| Boundary | Result |
|---|---|
| Local paging/order/count/transport behavior | Proven by focused tests and mutations |
| Lint/type-check/build/full aggregate test | PASS; 8,095 passed, 0 failed across local TAP blocks |
| Settled/voided staging population | Proven in staging CI; exact count matches, no page timeout |
| Track Only validated staging population | Proven in staging CI; exact count matches, no page timeout |
| Validated staging population | Proven in staging CI; exact count matches, no page timeout |
| Staging seeded duplicate boundary and live mutations | Proven in staging CI; 5 rows / pageSize 2; both mutations rejected |
| Production schema, index, DDL or data writes | None |
| Production behavior and row counts | Unproven; nothing deployed |
| Routing observation/provenance | Lane declaration recorded; outer wrapper observation pending |
| PM approval, merge, lane finalize and reconciliation | Pending authorized post-executor path |

No READY_FOR_REVIEW attestation, PM approval, truth-check success or completed closeout is claimed.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1832
Execution SHA: 4e351399be1b22510923486893d252a5a3584855
