# UTV2-1518 Diff Summary

Generated at: 2026-07-10T16:09:59Z
Issue: UTV2-1518
Tier: T2
Lane type: governance
Branch: codex/utv2-1518-file-scope-guard-proof-exemption
Head SHA: pending final head

## Summary
- Restricted trusted `scope_override` resolution to the PR branch's own lane manifest.
- Preserved the documented override path for the PR branch manifest when PM evidence is present.
- Added regression coverage proving a well-formed override on another active lane manifest is ignored.

## Git Diff Stat
```text
 .ops/sync/UTV2-1518.yml                        | 12 +++++++
 docs/06_status/lanes/UTV2-1518.json            | 38 ++++++++++++++++++++++
 docs/06_status/proof/UTV2-1518/.gitkeep        |  0
 docs/06_status/proof/UTV2-1518/diff-summary.md | 39 +++++++++++++++++++++++
 docs/06_status/proof/UTV2-1518/verification.md | 28 ++++++++++++++++
 scripts/ci/file-scope-guard.test.ts            | 44 ++++++++++++++++++++++++--
 scripts/ci/file-scope-guard.ts                 | 17 ++++++----
 7 files changed, 169 insertions(+), 9 deletions(-)
```

## Git Name Status
```text
A	.ops/sync/UTV2-1518.yml
A	docs/06_status/lanes/UTV2-1518.json
A	docs/06_status/proof/UTV2-1518/.gitkeep
A	docs/06_status/proof/UTV2-1518/diff-summary.md
A	docs/06_status/proof/UTV2-1518/verification.md
M	scripts/ci/file-scope-guard.test.ts
M	scripts/ci/file-scope-guard.ts
```

## Final Scope Check
- Rebased onto `origin/main` before PR prep so the diff does not include stale UTV2-1512/UTV2-1513 parked-lane moves.
- `npx tsx scripts/ci/file-scope-guard.ts --base origin/main --head HEAD --branch codex/utv2-1518-file-scope-guard-proof-exemption --manifest-source git`: PASS

## R-Level
`npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`

```text
Verdict: PASS
Changed files: 7
Rules matched: (none) -- no R-level artifacts required for this diff
```

## SHA Binding
Head SHA: pending final head
Merge SHA: pending
