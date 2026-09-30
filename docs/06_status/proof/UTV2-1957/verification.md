# PROOF: UTV2-1957

MERGE_SHA: pending merge

Issue: UTV2-1957
Tier: T1
result: pass

| Commit SHA(s) | `7c8d6acda30729d48934d97b5595350586d340fb` (verified source SHA) |
| --- | --- |

## ASSERTIONS:

- [x] The production verifier accepts only canonical production project `zfzdnfwdarxucxtaojxm` and `warehouse_reader` identity.
- [x] Every production SQL operation is read-only; the workflow carries no writable production credential.
- [x] Exact migration-ledger alignment, UTV2-1370 presence, phase privilege boundaries, RLS, and enabled immutability triggers are mandatory and fail closed.
- [x] The production workflow is manual, trusted-`main` only, emits an immutable receipt, and cannot substitute for the separately required Live Schema Parity PASS.
- [x] Writable DB suites remain staging-only.
- [x] Lost ephemeral preflight state was recovered only from the immutable pristine lane-start manifest, which independently proves `t1_live_db_precondition: deferred_to_ci`.

## EVIDENCE:

```text
Verified source SHA: 7c8d6acda30729d48934d97b5595350586d340fb

pnpm exec tsx --test scripts/ci/workflow-production-credential-guard.test.ts scripts/ci/staging-path-enforcement.test.ts scripts/ops/lane-link-pr.test.ts
tests 97; pass 97; fail 0

pnpm type-check
PASS

pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head 7c8d6acda30729d48934d97b5595350586d340fb
Verdict: PASS
Changed files: 10
Rules matched: (none)

pnpm verify
verify:static PASS, including lint, type-check, build, full test graph, Smart Form non-browser verification, command manifest, and migration checks.
test:live-db REFUSED locally because the configured host was 127.0.0.1 rather than governed staging project xskgrzbteyqdufktjrjx. This is the expected fail-closed boundary. The exact-head protected staging-ci run remains mandatory before review.

pnpm ops:lane-link-pr --issue UTV2-1957 --branch codex/utv2-1957-production-post-migration --pr https://github.com/griff843/Unit-Talk-v2/pull/1698
lane_linked; preflight_recovered=true
Recovered token carries t1_live_db_precondition=deferred_to_ci from immutable manifest-introduction evidence.
```

## Verification

- [x] `pnpm exec tsx --test scripts/ci/workflow-production-credential-guard.test.ts scripts/ci/staging-path-enforcement.test.ts scripts/ops/lane-link-pr.test.ts`: 97 pass, 0 fail.
- [x] `pnpm type-check`: PASS.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head 7c8d6acda30729d48934d97b5595350586d340fb`: PASS; no R-level rules matched.
- [x] `pnpm verify:static` (via `pnpm verify`): PASS.
- [ ] `pnpm test:live-db`: intentionally not satisfied locally; local containment URL was refused. Required exact-head `staging-ci` proof must pass before PM review.
- [ ] Production read-only verifier: intentionally not run before merge and PM authorization.
- [ ] Production Live Schema Parity: intentionally not run before merge; remains mandatory after the verifier.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1698
Execution SHA: 7c8d6acda30729d48934d97b5595350586d340fb
