# UTV2-1892 Diff Summary

Generated at: 2026-09-13T07:47:48.000Z
Issue: UTV2-1892
Tier: T1
Lane type: runtime
Branch: claude/utv2-1892-merge-gate-work-identity
PR URL: pending
Head SHA: f638dd89f2b9e449062461712f5da5a4e0a40c0a
Merge SHA: pending merge
Diff base: abe364761b1822984a2f21d38ce0457436ba9c34 (origin/main at lane start)
Diff target: f638dd89f2b9e449062461712f5da5a4e0a40c0a

## Git Diff Stat
```
 .github/workflows/merge-gate.yml       |   6 +-
 .ops/sync/UTV2-1892.yml                | 103 +++++++++++++++++++++++++++++++++
 docs/06_status/lanes/UTV2-1892.json    |  38 ++++++++++++
 scripts/ops/merge-gate-verdict.cjs     |   2 +-
 scripts/ops/merge-gate-verdict.test.ts |  39 +++++++++++++
 5 files changed, 184 insertions(+), 4 deletions(-)
```

## Git Name Status
```
M	.github/workflows/merge-gate.yml
A	.ops/sync/UTV2-1892.yml
A	docs/06_status/lanes/UTV2-1892.json
M	scripts/ops/merge-gate-verdict.cjs
M	scripts/ops/merge-gate-verdict.test.ts
```

## What changed
- `.github/workflows/merge-gate.yml` -- the branch/title issue extraction (line 243-244) and the
  WFR-v2 validators' branch extraction (line 658) admit `WORK-\d+` alongside `UTV2-`/`UNI-`.
- `scripts/ops/merge-gate-verdict.cjs` -- the `Issue:` line of a `pm-verdict/v1` comment admits
  `WORK-\d+`.
- `scripts/ops/merge-gate-verdict.test.ts` -- three-identity exact-head loop plus a drift lock
  binding the workflow's alternations to the parser's.

## What did not change
`AUTHORIZED_REVIEWERS`, CODEOWNERS, branch protection, required checks, the T1 approval rule,
the bootstrap identity path, bounce limits, supersession order. The proof directory's
`.gitkeep` from lane-start is replaced by this bundle.
