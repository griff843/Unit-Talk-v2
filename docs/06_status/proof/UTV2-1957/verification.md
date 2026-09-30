# PROOF: UTV2-1957

MERGE_SHA: pending merge

Issue: UTV2-1957
Tier: T1
result: pass

| Commit SHA(s) | `fd948c664315bf6de30d1dfa0dc8b398f4ce01b5` (verified source SHA) |
| --- | --- |

## ASSERTIONS:

- [x] The production verifier accepts only canonical production project `zfzdnfwdarxucxtaojxm` and `warehouse_reader` identity.
- [x] Every production SQL operation is read-only; the workflow carries no writable production credential.
- [x] Exact migration-ledger alignment, UTV2-1370 presence, phase privilege boundaries, absence of direct/transitive phase-role memberships, RLS, and valid `ORIGIN`/`ALWAYS` immutability triggers are mandatory and fail closed.
- [x] The production workflow is manual, trusted-`main` only, emits an immutable receipt, and cannot substitute for the separately required Live Schema Parity PASS.
- [x] Writable DB suites remain staging-only.
- [x] Lost ephemeral preflight state was recovered only from the immutable pristine lane-start manifest, which independently proves `t1_live_db_precondition: deferred_to_ci`.

## EVIDENCE:

```text
Verified source SHA: fd948c664315bf6de30d1dfa0dc8b398f4ce01b5

pnpm test:production-post-migration
tests 11; pass 11; fail 0

pnpm exec tsx --test scripts/ci/workflow-production-credential-guard.test.ts scripts/ci/staging-path-enforcement.test.ts
tests 75; pass 75; fail 0

pnpm type-check
PASS

pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head fd948c664315bf6de30d1dfa0dc8b398f4ce01b5
Verdict: PASS
Changed files: 10
Rules matched: (none)

pnpm verify:static
PASS, including the dedicated production post-migration verifier suite, lint, type-check, build, full test graph, Smart Form non-browser verification, command manifest, and migration checks.
```

## Verification

- [x] `pnpm test:production-post-migration`: 11 pass, 0 fail.
- [x] `pnpm exec tsx --test scripts/ci/workflow-production-credential-guard.test.ts scripts/ci/staging-path-enforcement.test.ts`: 75 pass, 0 fail.
- [x] `pnpm type-check`: PASS.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head fd948c664315bf6de30d1dfa0dc8b398f4ce01b5`: PASS; no R-level rules matched.
- [x] `pnpm verify:static` (via `pnpm verify`): PASS.
- [ ] `pnpm test:live-db`: intentionally not satisfied locally; local containment URL was refused. Required exact-head `staging-ci` proof must pass before PM review.
- [ ] Production read-only verifier: intentionally not run before merge and PM authorization.
- [ ] Production Live Schema Parity: intentionally not run before merge; remains mandatory after the verifier.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1698
Execution SHA: fd948c664315bf6de30d1dfa0dc8b398f4ce01b5
