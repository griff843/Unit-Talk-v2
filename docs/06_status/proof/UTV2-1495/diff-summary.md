# UTV2-1495 Diff Summary

## Summary

- Added `scripts/ci/file-scope-guard.ts` as the repo-owned file-scope enforcement entrypoint.
- Added `scripts/ci/file-scope-guard.test.ts` coverage for exact/directory locks, own-lane scope checks, proof-path allowance, missing own manifest fail-closed behavior, active-lane overlap detection, done-lane exclusion, and trusted-manifest resolution (base-branch baseline, first-commit locking, documented override).
- Rewired `.github/workflows/file-scope-lock-check.yml` to install repo dependencies, collect PR changed files, extract and run a **trusted** (base-branch) copy of the guard, and post structured PR comments on failures.
- Registered `scripts/ci/file-scope-guard.test.ts` in `package.json`'s `test:ops` list so `pnpm test` / `pnpm verify` actually execute it (Codex P2 finding).
- Added `resolveTrustedManifests` + a `scope_override` field so the guard cannot be defeated by a PR that simultaneously edits an out-of-scope file, this guard script, or its own lane manifest in the same diff (Codex P1 finding).

## Scope

- Implementation paths:
  - `.github/workflows/file-scope-lock-check.yml`
  - `scripts/ci/file-scope-guard.ts`
  - `scripts/ci/file-scope-guard.test.ts`
  - `package.json` (`test:ops` script list only — one entry added)
- Proof paths:
  - `docs/06_status/proof/UTV2-1495/diff-summary.md`
  - `docs/06_status/proof/UTV2-1495/verification.md`

## Behavior

- Lane PRs with an active manifest now fail when changed files are outside their own `file_scope_lock` or declared `expected_proof_paths`.
- Lane-like PR branches fail closed when no active manifest exists for the branch.
- Existing protection against overlaps with other active lane manifests is preserved.
- **Trust boundary (new):** the CI workflow executes the base-branch (`origin/main`) copy of the guard script, not the PR's own copy (bootstrap exception only for this introducing PR). Manifest content used for evaluation (`--manifest-source git`) is resolved the same way: a manifest that already existed on the base branch is read from the base branch regardless of what the PR's diff does to it; a manifest newly introduced by the branch is locked to the content of the commit that first added it, so a later commit in the same PR cannot widen `file_scope_lock` after the fact.
- **Documented override (new):** a manifest may carry a `scope_override: { approved_by, reason, evidence }` block; when well-formed (all three fields non-empty), the guard trusts the manifest's current content instead of the base/first-commit baseline. A missing or malformed override is never honored. See `docs/06_status/proof/UTV2-1495/verification.md#manifest-scope-correction` for this PR's own (legitimate) use of the override to correct an earlier `lane-start` CLI-parsing bug.
