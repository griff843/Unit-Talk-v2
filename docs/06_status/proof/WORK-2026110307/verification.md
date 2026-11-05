# PROOF: WORK-2026110307

MERGE_SHA: pending merge

Issue: WORK-2026110307
Tier: T1
Source SHA: 4e351399be1b22510923486893d252a5a3584855
result: draft_live_proof_deferred

## ASSERTIONS:

- [x] All six callbacks use the last database `(created_at, id)` tuple; subsequent ranges start at zero. Descending histories use `<`, ascending picks use `>`.
- [x] Duplicate timestamps cross page boundaries without skips or duplicates; SDK transport checks all six callbacks and encodes `+00:00` exactly once while retaining all microseconds.
- [x] Short pages end reads; oversized page caps and page errors fail. Existing explicit limit/offset contracts and completeness/order/budget checks remain covered.
- [x] A count change, including deletion behind the cursor, restarts the whole pick read. Three unstable attempts fail with `population count changed while paging`. Each attempt owns a fresh result, cursor, count and identity set.
- [x] Local mutations removing the ID tie break, truncating timestamps through Date, and removing the count comparison fail tests.
- [ ] Live population timing/count reconciliation and seeded boundary/mutation evidence: deferred to staging-ci.

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

The live suite submits five run-namespaced Track Only fixtures through `processSubmission`, changes only their `created_at` to one shared microsecond timestamp, reads with page size two, and checks the independent ordered DB result. It also asserts that dropping the ID tie break and re-serializing the timestamp through Date fail. These live assertions have been authored but have not run locally. Fixture records are retained with their namespace; no audit history is deleted or lifecycle state written directly.

## Verification

- Focused issue tests: PASS, with one explicit staging skip.
- API server tests: PASS (67/67).
- `pnpm exec tsx scripts/ci/db-writer-inventory.ts`: PASS.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS.
- `pnpm verify:static` (final run inside `pnpm verify`): PASS, including lint, type-check, build, aggregate tests, post-migration tests, Smart Form verification and command verification. Across local TAP blocks: 8,108 tests, 8,095 passed, 0 failed, 13 skipped. Browser Smart Form e2e was not enabled.
- `pnpm verify`: exit 1 at the following `test:live-db` staging identity gate. The full gate is NOT green; live DB verification remains deferred.
- Proof markdown binding and declared routing validation: PASS. The runtime evidence contract is BLOCKED only on missing live queries and row counts; no runtime receipts are fabricated.
- `pnpm test:db`: BLOCKED/DEFERRED, exit 1. The staging identity guard refused host=127.0.0.1 before running writable tests.

Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (host=unparseable). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.

The paragraph above records the packet's precondition. The measured local `test:db` guard identified host=127.0.0.1. Both refuse an unproven staging target; neither result is live performance evidence.

## Attempt 2 verification

Source SHA: 4e351399be1b22510923486893d252a5a3584855

The staging fixture assertion now uses `assert.notEqual(result.duplicate, true)`: fresh submissions omit the optional field. The remaining live assertions contain no similar optional-field defect. Runtime reader code is unchanged.

- Focused paging, server and live suites: 179 tests, 178 passed, 0 failed, 1 staging skip.
- `pnpm verify:static` inside `pnpm verify`: PASS; 8,108 tests, 8,095 passed, 0 failed, 13 skipped across local TAP blocks.
- `pnpm verify`: exit 1 at the staging identity guard (host=127.0.0.1); writable tests did not run.
- R-level: PASS; no matched rules.
- Live timing, exact counts and seeded boundary/mutation proof remain deferred to staging-ci. Runtime query and row-count receipts remain empty.

## Verification boundary

| Boundary | Result |
|---|---|
| Local paging/order/count/transport behavior | Proven by focused tests and mutations |
| Lint/type-check/build/full aggregate test | PASS; 8,095 passed, 0 failed across local TAP blocks |
| Settled/voided staging population | Deferred; no timing or exact-count claim |
| Track Only validated staging population | Deferred; no timing or exact-count claim |
| Validated staging population | Deferred; no timing or exact-count claim |
| Staging seeded duplicate boundary and live mutations | Deferred; suite registered in test:t1-proof:live |
| Production schema, index, DDL or data writes | None |
| Routing observation/provenance | Lane declaration recorded; outer wrapper observation pending |
| PM approval, merge, lane finalize and reconciliation | Pending authorized post-executor path |

No READY_FOR_REVIEW attestation, PM approval, truth-check success or completed closeout is claimed.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1832
Execution SHA: 4e351399be1b22510923486893d252a5a3584855
