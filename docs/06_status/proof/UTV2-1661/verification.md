# PROOF: UTV2-1661 tier-aware pre-merge authorization

MERGE_SHA: 2ecdd5b888aba02fac1c9f69dfb2fff74d4f7471

## Summary

`authorized` ANDed the pm-verdict requirement in for every PR regardless of tier, double-gating
T2/T3 against a rule that only applies to T1 and surfacing a T1-only failure message on non-T1
PRs. Tier authority now comes from the lane manifest at the PR head, labels are mirrored
evidence only, and relaxation additionally requires an exact-head green `Merge Gate`.

## Verification

Executed on head `2ecdd5b888aba02fac1c9f69dfb2fff74d4f7471`.

## ASSERTIONS:

- [x] Full suite green: 4,452 tests, 4,452 pass, 0 fail, 0 skipped, `PNPM_EXIT=0` captured directly to a file rather than through a pipe.
- [x] Focused file green: 38 pass, 0 fail.
- [x] `pnpm lint` exit 0.
- [x] `pnpm type-check` exit 0.
- [x] Tier authority is the lane manifest at the PR head; PR labels never relax a T1 requirement.
- [x] A T1 manifest carrying a mutable `tier:T2` label cannot relax authority.
- [x] Manifest/label disagreement fails closed even when both values are non-T1.
- [x] A missing `Merge Gate` context, an empty required-check set, a stale/non-current-head `Merge Gate`, and a duplicate `Merge Gate` identity each fail closed.
- [x] A T2 manifest with a current-head green `Merge Gate` and no verdict is authorized, with no T1-only message emitted.
- [x] `Merge Gate Evaluator` is never accepted as a substitute for `Merge Gate`.
- [x] The production default manifest reader is implemented and exercised by integration tests with no injected dep; the prior head defaulted to `async () => null`, leaving the double-gate intact outside tests.
- [x] The manifest is read at the exact head SHA, not the branch ref, and its `issue_id` identity is validated.
- [x] Confirmed 404 resolves to unresolved/strict; auth, rate-limit, network, 5xx, malformed base64 and malformed JSON raise `LaneManifestLookupError` and fail closed.
- [x] Fail-closed ingestion of authority is preserved: no path relaxes on absent or unreadable data.
- [x] Lane manifest records `executor: codex-cli`, matching the governed routing identity and the `codex/` branch.

## EVIDENCE:

Full suite, exit code captured directly:

```
PNPM_EXIT=0
notok=0
tests=4452 pass=4452 fail=0 skipped=0
```

Focused file:

```
$ npx tsx --test scripts/ops/pre-merge-authorization.test.ts
# tests 38
# pass 38
# fail 0
```

Lint and type-check:

```
LINT_EXIT=0
TC_EXIT=0
```

## Attribution

Governed lane identity is `codex-cli`, matching the branch and worktree. The implementation in
this correction round was performed by Claude operating under that lane identity; recorded here
for attribution rather than altering the manifest's routing truth.

## Scope

`scripts/ops/pre-merge-authorization.ts`, `scripts/ops/pre-merge-authorization.test.ts`, the
lane manifest's executor identity, and this proof bundle. Merge Gate itself is untouched.
