# UTV2-1495 Diff Summary

## Summary

- Added `scripts/ci/file-scope-guard.ts` as the repo-owned file-scope enforcement entrypoint.
- Added `scripts/ci/file-scope-guard.test.ts` coverage for exact/directory locks, own-lane scope checks, proof-path allowance, missing own manifest fail-closed behavior, active-lane overlap detection, and done-lane exclusion.
- Rewired `.github/workflows/file-scope-lock-check.yml` to install repo dependencies, collect PR changed files, run the TypeScript guard, and post structured PR comments on failures.

## Scope

- Implementation paths:
  - `.github/workflows/file-scope-lock-check.yml`
  - `scripts/ci/file-scope-guard.ts`
  - `scripts/ci/file-scope-guard.test.ts`
- Proof paths:
  - `docs/06_status/proof/UTV2-1495/diff-summary.md`
  - `docs/06_status/proof/UTV2-1495/verification.md`

## Behavior

- Lane PRs with an active manifest now fail when changed files are outside their own `file_scope_lock` or declared `expected_proof_paths`.
- Lane-like PR branches fail closed when no active manifest exists for the branch.
- Existing protection against overlaps with other active lane manifests is preserved.
