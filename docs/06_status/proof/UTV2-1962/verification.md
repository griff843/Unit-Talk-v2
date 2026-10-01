# PROOF: UTV2-1962

MERGE_SHA: pending merge

> Scaffolded by `ops:lane-start`. Nothing below has been run. Record each command
> actually executed and its real result before review. `post-merge-lane-close.yml`
> binds the merge SHA; never write one here by hand.

Issue: UTV2-1962
Tier: T2
result: not_run

## ASSERTIONS:

- [ ] (state each behavior this lane proves, and the test that proves it)

## EVIDENCE:

(paste measured output here, in fenced blocks)

## Verification

(record every verification command run on the final code commit, with its real result)

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Execution SHA: 0b87906c03359b128d53a61daa539d8bc8715239
# Verification Results

UTV2-1962 adds Trial role forwarding to both governed deployment environment writers.
Focused deploy regression tests: 34/34 pass, including configured Trial preservation and omission when absent.
pnpm verify: env check, lint, type-check, build and local test suites passed; final writable DB phase REFUSED the unidentified localhost target. Full pnpm verify is not claimed green locally. Governed CI staging verification is required before merge.
R-level check: PASS; no runtime/domain/lifecycle/UI paths match artifact rules.

`pnpm type-check` and `pnpm test` passed within the local `pnpm verify` run. `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` returned PASS. The final staging-only DB phase remains subject to governed CI verification as stated above.

## Scope Audit

Implementation changes only .github/workflows/deploy.yml and scripts/ci/deploy-parked-mode.test.ts; generated lane/proof metadata is separate. No kill-switch, target, provider, permission, role assignment or commerce changes. Production deployment acceptance remains pending.

## Mutation Safety

Trial serialization must emit the selected role ID exactly. An absent or empty setting emits no Trial environment entry, preserving optional-role semantics; regressions exercise both stages with bash. Existing containment regression coverage remains intact.

