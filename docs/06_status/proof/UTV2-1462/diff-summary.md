# UTV2-1462 Diff Summary

Issue: UTV2-1462
Tier: T2
Branch: claude/utv2-1462-ci-bookkeeping-path-filter

## Summary

- Adds `paths-ignore` to the `push` trigger in `.github/workflows/ci.yml` so pushes to main touching ONLY lane manifests (`docs/06_status/lanes/**`), proof bundles (`docs/06_status/proof/**`), or sync files (`.ops/sync/**`) skip the ~9-minute verify chain.
- Fail-closed by GitHub semantics: `paths-ignore` skips only when EVERY changed file matches the list — a push mixing bookkeeping with any other path runs full verify.
- `pull_request` trigger untouched: the required `verify` PR context behaves exactly as before.
- Halves the open-PR invalidation cost of every lane closeout (each closeout previously triggered a full main CI run that re-invalidated all open PRs under strict branch protection).

## Scope

- .github/workflows/ci.yml (trigger block only — no job changes)
- docs/06_status/lanes/UTV2-1462.json (lane manifest)
- docs/06_status/proof/UTV2-1462/ (this proof bundle)

## R-Level

`scripts/ci/r-level-check.ts --base origin/main --head HEAD`: Verdict PASS — workflow-only diff matches no R1–R5 runtime rules.
