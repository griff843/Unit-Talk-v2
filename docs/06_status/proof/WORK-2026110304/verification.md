# PROOF: WORK-2026110304

Issue: WORK-2026110304 — Tier T2
Source SHA: f4c34cb62541883c8be560b320a7a528cd4199aa
MERGE_SHA: pending merge
Result: static gates pass; writable live DB deferred; browser acceptance not claimed.

Rework baseline: 11f88bde1c700cf5841b8fa2e88f73c106d0303a. New assertions ran before implementation: 39 tests, 36 passing and 3 failing because the page formatter hid the invalid-date guidance. With OperatorInputError, all 39 pass. Ordinary Error, database-shaped object and string with identical text still receive generic wording. Original main regression-first evidence and prepared candidates are retained in evidence.json as historical inputs, not new-epoch phase validity.

## Verification

| Command | Result |
|---|---|
| Focused queues-count-relation and describe-error tests (`pnpm exec tsx --test`) | 39/39 PASS |
| Operator-surface server tests (`pnpm exec tsx --test apps/operator-web/src/server.test.ts apps/command-center/src/lib/server-api.test.ts`) | 20/20 PASS |
| `pnpm verify` (includes `pnpm verify:static`, type-check and full test suite) | Static PASS; full command exit 1 at deferred writable DB guard |
| `pnpm type-check` (stage of `pnpm verify:static`, also run separately) | PASS |
| `pnpm test` (stage of `pnpm verify:static`) | PASS |
| `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS; artifact presence only |

Full source verification log and focused regression logs are copied into evidence.json. Final proof-head results and log digests belong in `.out/ops/ready-for-pr/WORK-2026110304.md`.

Writable live-DB proof is blocked/deferred. The packet reports host=unparseable; local guard reports host=127.0.0.1/ref=unidentified. Writable DB verification requires xskgrzbteyqdufktjrjx through staging-ci with CI_SUPABASE_* credentials. No writable DB proof or production access occurred. Full verify is not green.

Every describeOperatorFailure caller was reviewed again. Picks and Review retain critical DegradedState branches. API Health retains its unavailable runtime panel and independently loaded provider section. Exceptions keeps fulfilled sources via Promise.allSettled, renders loadErrors, and suppresses empty success while errors exist. No caller changed. describeThrown remains byte-for-byte unchanged from main; raw diagnostics remain available to server logs. This is source review, not browser acceptance.

R-level PASS checks existing artifacts, including a historical browser FAIL. origin/main advanced; its two-dot comparison also includes unrelated mainline work and matches lifecycle-fsm. The three-dot lane diff remains bounded. No branch refresh or unrelated fix was attempted.

PM approval, staging DB proof, PR opening/labeling, merge, lane finalization and post-merge reconciliation remain for the authorized outer path. No READY_FOR_REVIEW attestation published.

ASSERTIONS:
- [x] Calendar "From" (`YYYY-MM-DD`) filters `gte` at that day's UTC midnight; calendar "To" filters `lt` at the next UTC midnight, so the whole selected day is included.
- [x] Full timestamp values keep their exact `gte`/`lte` behaviour.
- [x] An impossible calendar date throws `OperatorInputError`, and the Picks error state shows its date guidance instead of widening or dropping the filter.
- [x] `describeOperatorFailure` returns operator language for permission, session, timeout and generic failures; an ordinary Error, database-shaped object or string with identical text still receives generic wording.
- [ ] Browser acceptance of the rendered pages. Not claimed; see "Verification boundary".

EVIDENCE:
- Focused tests: `queues-count-relation.test.ts` and `describe-error.test.ts`, 39/39 pass at f4c34cb62; 36/39 on the unmodified rework baseline 11f88bde1 (regression first).
- Operator-surface server tests: 20/20 pass.
- `pnpm verify`: static stage passes; the command exits 1 only at the writable DB guard, which refuses a non-staging local target before any write.
- The exact-head PR CI run is the authority for green status; this file does not claim it.

```text
focused: queues-count-relation.test.ts + describe-error.test.ts -> 39/39 pass at f4c34cb62
baseline 11f88bde1 (unmodified rework baseline) -> 36/39 (regression first)
operator-surface server tests -> 20/20 pass
```

## Verification boundary

| Link | Status |
|---|---|
| Date filter construction and invalid-date handling | Proven by unit tests against the query builder |
| Operator-language error mapping | Proven by unit tests |
| Same filtered population for rows and count | Proven by the count-relation test |
| Rendered Command Center pages in a browser | Not proven; source review of callers only |
| Writable DB behaviour | Not exercised; this lane changes no write path |

A green run is not a readiness claim. Known cosmetic gap: the Picks page still wraps the invalid-date guidance in its existing critical "Active picks unavailable" banner; `page.tsx` is outside this lane's file scope.

Proof restructured into the gate format by Production Claude (orchestrator); no source or test file changed.

## Merge SHA Binding

Merge SHA: pending merge
PR: #1828
