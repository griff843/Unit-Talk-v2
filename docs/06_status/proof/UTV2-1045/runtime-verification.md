## Summary

UTV2-1045: Expanded runtime-verifier-gate.yml trigger paths. No runtime behavior changed — this is a CI governance fix only.

## Evidence

**Change scope:** `.github/workflows/runtime-verifier-gate.yml` — `on.pull_request.paths` expanded from 1 entry to 17 paths covering all R-level classified runtime files.

**Verification commands run in worktree:**
- `pnpm verify:quick` — exit 0
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS (no R-level artifacts required)

**No runtime-sensitive code changed.** This PR only modifies a CI workflow trigger filter. The gate itself is unchanged; only its activation condition is broadened.

## Verification

- [x] `pnpm verify:quick` green
- [x] R-level compliance check: PASS
- [x] Tier label `tier:T2` applied to PR #794
- [x] No runtime code modified — CI-only change
- [x] Scope: single workflow file (`.github/workflows/runtime-verifier-gate.yml`)
