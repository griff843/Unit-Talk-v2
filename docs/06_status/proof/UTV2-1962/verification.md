# PROOF: UTV2-1962

MERGE_SHA: 52fcf55f92c41c534deca68218cd3adc7b95bcda

Implementation verification is recorded below. Production deployment acceptance remains pending. The trusted post-merge lane workflow binds the merge SHA.

Issue: UTV2-1962
Tier: T2
result: not_run

## ASSERTIONS:

- [x] Both deployment stages preserve the configured Trial role exactly.
- [x] Both stages omit the optional Trial entry when empty.
- [x] Existing containment regression coverage remains green.
- [ ] Production mapping and deployed guard acceptance, after protected deployment.

## EVIDENCE:

Focused command: `pnpm exec tsx --test scripts/ci/deploy-parked-mode.test.ts`.

```text
# tests 34
# pass 34
# fail 0
```

Local `pnpm verify` final DB phase (static phases and local tests passed):

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
ELIFECYCLE Command failed with exit code 1.
```

Governed CI run 36802455727 on predecessor proof head 0a1ed61df0a97f8c4c8aeb0773111ff0741074c2 measured both `Writable DB proof (staging only)` and `verify` SUCCESS. Its runtime implementation is identical; the final proof-format correction still requires fresh exact-head CI. No production DB was used for writable testing.

## Verification

`pnpm verify`: static/local phases PASS, local writable DB REFUSED; governed staging CI above PASS. `pnpm type-check` and `pnpm test` passed in the local verify run. `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS, no matched rules.

## Merge SHA Binding

Merge SHA: 52fcf55f92c41c534deca68218cd3adc7b95bcda
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

