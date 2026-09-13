# UTV2-1892 Diff Summary

Generated at: 2026-09-13T08:05:20.000Z
Issue: UTV2-1892
Tier: T1
Lane type: runtime
Branch: claude/utv2-1892-merge-gate-work-identity
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1570
Head SHA: 63115cbff33f0196bbe8d9aa182345be33effb0b
Merge SHA: pending merge
Diff base: abe364761b1822984a2f21d38ce0457436ba9c34 (origin/main at lane start)
Diff target: 63115cbff33f0196bbe8d9aa182345be33effb0b

## Git Diff Stat
```
 .github/workflows/merge-gate.yml               |  10 +-
 .ops/sync/UTV2-1892.yml                        | 103 +++++++++++++++++++
 docs/06_status/lanes/UTV2-1892.json            |  38 +++++++
 docs/06_status/proof/UTV2-1892/diff-summary.md |  44 ++++++++
 docs/06_status/proof/UTV2-1892/evidence.json   | 133 +++++++++++++++++++++++++
 docs/06_status/proof/UTV2-1892/verification.md | 109 ++++++++++++++++++++
 scripts/ops/merge-gate-verdict.cjs             |   2 +-
 scripts/ops/merge-gate-verdict.test.ts         | 102 +++++++++++++++++++
 8 files changed, 536 insertions(+), 5 deletions(-)
```

## Git Name Status
```
M	.github/workflows/merge-gate.yml
A	.ops/sync/UTV2-1892.yml
A	docs/06_status/lanes/UTV2-1892.json
A	docs/06_status/proof/UTV2-1892/diff-summary.md
A	docs/06_status/proof/UTV2-1892/evidence.json
A	docs/06_status/proof/UTV2-1892/verification.md
M	scripts/ops/merge-gate-verdict.cjs
M	scripts/ops/merge-gate-verdict.test.ts
```

## What changed
- `.github/workflows/merge-gate.yml` -- the branch/title issue extraction (line 243-244) and the
  WFR-v2 validators' branch extraction (line 660) admit `WORK-\d+` alongside `UTV2-`/`UNI-`, bounded at both ends so an identifier embedded in a longer token does not resolve.
- `scripts/ops/merge-gate-verdict.cjs` -- the `Issue:` line of a `pm-verdict/v1` comment admits
  `WORK-\d+`.
- `scripts/ops/merge-gate-verdict.test.ts` -- three-identity exact-head loop, a drift lock binding the
  workflow's alternations to the parser's (in both directions), and a boundary test evaluating the
  three extractors as read from the workflow against branch and title samples.

## What did not change
`AUTHORIZED_REVIEWERS`, CODEOWNERS, branch protection, required checks, the T1 approval rule,
the bootstrap identity path, bounce limits, supersession order. The proof directory's
`.gitkeep` from lane-start is replaced by this bundle.
