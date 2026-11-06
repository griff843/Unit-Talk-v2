# WORK-2026110601 — verification

Issue: WORK-2026110601. Tier: T1. Result: static PASS; writable staging deferred to CI.

Source SHA: `f246e1b0ec32fb0cf300de41b188172b24f1d411` (runtime and tests).
Evidence commit and current PR head are resolved by CI. Merge SHA: pending merge.

## Commands and results

| Command | Measured result |
|---|---|
| `pnpm exec tsx --test packages/db/src/member-performance-read-completeness.test.ts` | PASS: 139/139, zero skipped. Includes all 125 existing regressions and 14 added regressions. |
| `pnpm type-check` | PASS after fixing closure cursor narrowing with a captured constant. Initial attempt failed TS2345; the complete static gate also passes type-check on the final source. |
| `pnpm verify` | Exit 1 at local staging identity guard, after the entire static subgate passed. No writable tests executed. |
| `pnpm verify:static` (invoked by `pnpm verify`) | PASS: lint, type-check, build, aggregate tests, production-post-migration tests, Smart Form checks and command/migration checks. 8,136 tests total, 8,123 pass, zero fail, 13 skipped. Optional Smart Form browser E2E was not enabled. |
| `pnpm test:db` | Exit 1: staging identity guard refused host=127.0.0.1 before writes. |
| `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS; no matching R1–R5 rules, no additional R-level artifacts required. |
| Evidence / model-routing structural validators | PASS. Structure does not establish live DB truth. |
| `git diff --check` | PASS. |

Writable live-DB proof is blocked/deferred locally. The packet recorded host=unparseable; the observed local refusal is host=127.0.0.1. Both fail identity resolution. Writable DB verification requires `xskgrzbteyqdufktjrjx`, through the `staging-ci` GitHub environment with `CI_SUPABASE_*` credentials. No credential files were copied or changed.

## Assertions

- Transient 57014, returned or thrown, on W/check 2/check 3/end count succeeds on try two and equals the oracle without restarting data pages.
- Persistent 57014 on each statement rejects after exactly three tries, contains 57014 and HTTP 500, and never returns that attempt's rows.
- Empty error messages receive a nonempty fallback.
- Check 2 retry retains W. A membership change during its failed first statement is detected on retry; the drifted rows are discarded and the existing fresh whole-read attempt equals the oracle.
- Exact cursor text, keyset paging, redundant created_at bound, ordering, count validation, drift retry, row budget and page cap retain their prior regressions.

## Regression and mutation controls

Each variant was run directly with `pnpm exec tsx --test packages/db/src/member-performance-read-completeness.test.ts`; final runtime source was restored and 139/139 passed afterward.

| Variant | Pass | Fail | Interpretation |
|---|---:|---:|---|
| Original runtime from source parent | 125 | 14 | All new regressions detect the original defect. |
| Three-try loop replaced by one try | 125 | 14 | Transient statement retry is required. |
| Statement loop made unbounded | 134 | 5 | Exhaustion rejects the mutation; fourth-try success tripwire prevents hanging. |
| Code omitted from exhausted error | 135 | 4 | Code assertions detect missing diagnostics. |

Raw output is in `focused-after.txt`, `regression-before.txt`, `mutation-*.txt`, `test-db.txt`, `r-level.txt` and `verify-tail.txt`. Machine summary and full local verification log hash are in `evidence.json`.

## Verification boundaries

| Claim | Boundary |
|---|---|
| Slowdown | Cause not identified; no measured speedup claimed. |
| Index | Index on picks(updated_at) not added; no DDL. |
| Local proof | Deterministic query-boundary failure injection; live DB access refused. |
| Staging proof | Exact-head CI must pass existing full T1 live suites, including the keyset live suite. CI links are on the draft PR. |
| Production | No mutation, deploy, kill-switch change, delivery or target activation. |
| Closeout | Draft review only. No PM approval, merge, child READY_FOR_REVIEW attestation, lane finalization, truth-check success or post-merge reconcile is claimed. |
