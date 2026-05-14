## Issue

UTV2-####

## Tier

<!-- EXACTLY ONE: tier:T1, tier:T2, or tier:T3 — apply label after opening: gh pr edit <num> --add-label "tier:T2" -->

## Lane

<!-- claude or codex -->

## Summary

<!-- 1-3 bullet points: what changed and why -->
-

## Files changed

<!-- Each file modified and what it does -->
-

## Verification

<!-- Paste last 20 lines of `pnpm verify` output -->
```
(paste output here)
```

## R-level compliance

<!-- Run: tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD — paste PASS output below -->
<!-- Which rules in r1-r5-rules.json are triggered by changed paths? -->
<!-- For each triggered rule: list required[] levels and whether artifacts are present -->
<!-- If no runtime paths touched: "N/A — no lifecycle/domain/strategy/UI paths touched" -->

## Test coverage

<!-- New or updated test files and what scenario each covers -->
-

## Merge order

<!-- Must this PR merge before or after any other currently open PR? -->
<!-- Independent: "No open lanes share overlapping files — no merge dependency." -->
<!-- Dependent: "Must merge after PR #NNN (UTV2-###) — that lane changes X which this PR imports." -->

## Proof artifact

<!-- T1: path to SHA-bound evidence bundle, e.g. docs/06_status/proof/UTV2-####.md -->
<!-- T2 runtime path: diff-summary or verification log -->
<!-- T3: "CI only" -->
