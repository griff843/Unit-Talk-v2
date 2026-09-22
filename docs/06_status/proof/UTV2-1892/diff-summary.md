# UTV2-1892 Diff Summary

Generated at: 2026-09-22T00:35:00.000Z
Issue: UTV2-1892
Tier: T1
Lane type: runtime
Branch: claude/utv2-1892-merge-gate-work-identity
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1570
Head SHA: d9d5a533b
Merge SHA: pending merge
Diff base: 6846fe19fb83158aa1735c47c922e6d5c582d234 (origin/main at readmission)
Diff target: d9d5a533b

## Git Diff Stat
```
 .github/workflows/merge-gate.yml               |  10 +-
 .ops/sync/UTV2-1892.yml                        | 103 +++++++++++
 docs/06_status/lanes/UTV2-1892.json            |  41 +++++
 docs/06_status/proof/UTV2-1892/diff-summary.md |  51 ++++++
 docs/06_status/proof/UTV2-1892/evidence.json   | 239 +++++++++++++++++++++++++
 docs/06_status/proof/UTV2-1892/verification.md | 144 +++++++++++++++
 scripts/ci/file-scope-guard.test.ts            | 217 ++++++++++++++++++++++
 scripts/ci/file-scope-guard.ts                 |  18 +-
 scripts/ops/merge-gate-verdict.cjs             |   2 +-
 scripts/ops/merge-gate-verdict.test.ts         | 102 +++++++++++
 10 files changed, 920 insertions(+), 7 deletions(-)
```

## Git Name Status
```
M	.github/workflows/merge-gate.yml
A	.ops/sync/UTV2-1892.yml
A	docs/06_status/lanes/UTV2-1892.json
A	docs/06_status/proof/UTV2-1892/diff-summary.md
A	docs/06_status/proof/UTV2-1892/evidence.json
A	docs/06_status/proof/UTV2-1892/verification.md
M	scripts/ci/file-scope-guard.test.ts
M	scripts/ci/file-scope-guard.ts
M	scripts/ops/merge-gate-verdict.cjs
M	scripts/ops/merge-gate-verdict.test.ts
```

## Manifest Files Changed
- No files_changed entries recorded.

## What changed
- `.github/workflows/merge-gate.yml` -- the branch/title issue extraction (lines 245-246) and the
  WFR-v2 validators' branch extraction (line 660) admit `WORK-\d+` alongside `UTV2-`/`UNI-`,
  bounded at both ends so an identifier embedded in a longer token (`homework-123`, `work-123abc`)
  does not resolve.
- `scripts/ops/merge-gate-verdict.cjs` -- the `Issue:` line of a `pm-verdict/v1` comment admits
  `WORK-\d+`.
- `scripts/ops/merge-gate-verdict.test.ts` -- three-identity exact-head loop, a drift lock binding
  the workflow's alternations to the parser's (in both directions), and a boundary test evaluating
  the three extractors as read from the workflow against branch and title samples.
- `scripts/ci/file-scope-guard.ts` -- the guard's two identity patterns (`ISSUE_BRANCH_PATTERN`,
  `ISSUE_ID_PATTERN`) now derive from one closed namespace set, `UTV2|UNI|WORK`. Before this,
  `laneLifecycleScopePatterns()` returned `[]` for a WORK issue ID, so the three files
  `ops:lane-start` itself creates -- the lane's manifest, its sync file and its proof directory --
  were reported as cross-lane bleed on the lane's own PR.
- `scripts/ci/file-scope-guard.test.ts` -- six tests: the WORK lifecycle grant, the exact
  namespace keying with a nine-case rejection list, the exact-lane refusal of another lane's
  manifest, ordinary `file_scope_lock` enforcement on a WORK lane, cross-lane conflict detection in
  both directions, and an unrecognised-namespace fail-closed pin.

## What did not change
`AUTHORIZED_REVIEWERS`, CODEOWNERS, branch protection, required checks, the T1 approval rule, the
bootstrap identity path, bounce limits, supersession order. Exact PR number, exact HEAD SHA and
authorized-reviewer checks are untouched and still fail closed. `tracker_ref` semantics are not
widened: `WORK` is repository-owned work identity, never a tracker reference, and nothing here
consults or produces a tracker ref. The file-scope grant stays EXACT-LANE -- no
`docs/06_status/lanes/**` or `.ops/sync/**` directory exemption was introduced.

## SHA Binding
Head SHA: d9d5a533b
Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1570
