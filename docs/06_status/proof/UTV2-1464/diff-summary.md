# UTV2-1464 Diff Summary

Generated at: 2026-07-04T20:18:46.490Z
Issue: UTV2-1464
Tier: T2
Lane type: verification
Branch: codex/utv2-1464-proof-generate-merge-sha-rebind
PR URL: N/A
Head SHA: 8a19412a0a937c6b3953a93b2d389350a836c143
Merge SHA: N/A
Diff base: c3826e31d50cd02a5c5a2b740c1e7977ce9d12c5
Diff target: 8a19412a0a937c6b3953a93b2d389350a836c143

## Git Diff Stat
```
.ops/sync/UTV2-1464.yml             | 10 ++++++++++
 docs/06_status/lanes/UTV2-1464.json | 39 +++++++++++++++++++++++++++++++++++++
 2 files changed, 49 insertions(+)
```

## Git Name Status
```
A	.ops/sync/UTV2-1464.yml
A	docs/06_status/lanes/UTV2-1464.json
```

## Manifest Files Changed
- No files_changed entries recorded.

## Lane Working Tree Changes
- `scripts/ops/proof-generate.ts`: switches standard proof generation from
  `runtime-verification.md` to `verification.md`, preserving existing SHA-binding
  verification bundles during merge-SHA rebind.
- `scripts/ops/proof-generate.test.ts`: updates proof-generation assertions for
  `verification.md` and the rebind collision behavior.
- `docs/06_status/proof/UTV2-1464/diff-summary.md`: generated proof diff summary.
- `docs/06_status/proof/UTV2-1464/verification.md`: verification record for this lane.

## SHA Binding
Head SHA: 8a19412a0a937c6b3953a93b2d389350a836c143
Merge SHA: N/A
